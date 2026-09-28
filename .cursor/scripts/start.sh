#!/usr/bin/env bash
# Sobe Postgres, o GoTrue (auth) e o proxy /auth/v1, aplica as migrations e
# grava os .env locais. Os processos do Next e do Nest ficam nos terminals.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GOTRUE_DIR="/opt/dentaltrack/gotrue"
JWT_SECRET="dentaltrack-local-dev-jwt-secret-32b"
DB_USER="dentaltrack"
DB_PASSWORD="dentaltrack"
DB_NAME="dentaltrack"
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
AUTH_DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}?sslmode=disable&search_path=auth"
DEV_EMAIL="dev@example.com"
DEV_PASSWORD="dentaltrack-local"
DEV_CLINIC="Empresa Local"
LOG="/tmp/dentaltrack-gotrue.log"

wait_for() {
  local name="$1"
  local tries="$2"
  shift 2
  local i
  for i in $(seq 1 "$tries"); do
    if "$@"; then
      return 0
    fi
    sleep 0.5
  done
  echo "start: ${name} não ficou pronto" >&2
  return 1
}

sudo service postgresql start
wait_for "postgres" 40 sudo -u postgres pg_isready -q

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' SUPERUSER;
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}' SUPERUSER;
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION ${DB_USER};"

sudo tee /etc/nginx/conf.d/dentaltrack-auth-cors.conf >/dev/null <<'EOF'
map $http_origin $dentaltrack_cors_origin {
  default "";
  "http://localhost:3000" $http_origin;
  "http://127.0.0.1:3000" $http_origin;
}
EOF
sudo tee /etc/nginx/sites-available/dentaltrack-auth >/dev/null <<'EOF'
server {
  listen 127.0.0.1:54321;
  server_name _;

  location /auth/v1/ {
    proxy_pass http://127.0.0.1:9999/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_hide_header Access-Control-Allow-Origin;
    add_header Access-Control-Allow-Origin $dentaltrack_cors_origin always;
    add_header Access-Control-Allow-Credentials true always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "apikey, authorization, content-type, x-client-info, x-supabase-api-version" always;
    add_header Access-Control-Expose-Headers "x-supabase-api-version" always;
  }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/dentaltrack-auth /etc/nginx/sites-enabled/dentaltrack-auth
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
if sudo service nginx status >/dev/null 2>&1; then
  sudo service nginx reload
else
  sudo service nginx start
fi

if ! curl -sf http://127.0.0.1:9999/health >/dev/null; then
  pid="$(ss -ltnp 2>/dev/null | sed -n 's/.*:9999 .*pid=\([0-9]*\).*/\1/p' | head -1 || true)"
  if [ -n "${pid}" ]; then
    kill "$pid" || true
    sleep 0.5
  fi
  (
    cd "$GOTRUE_DIR"
    export GOTRUE_JWT_SECRET="$JWT_SECRET"
    export GOTRUE_JWT_EXP="3600"
    export GOTRUE_JWT_AUD="authenticated"
    export GOTRUE_JWT_ADMIN_ROLES="service_role"
    export GOTRUE_DB_DRIVER="postgres"
    export GOTRUE_DB_DATABASE_URL="$AUTH_DB_URL"
    export DATABASE_URL="$AUTH_DB_URL"
    export API_EXTERNAL_URL="http://localhost:54321"
    export GOTRUE_API_HOST="127.0.0.1"
    export PORT="9999"
    export GOTRUE_MAILER_AUTOCONFIRM="true"
    export GOTRUE_DISABLE_SIGNUP="false"
    export GOTRUE_SITE_URL="http://localhost:3000"
    export GOTRUE_URI_ALLOW_LIST="http://localhost:3000,http://127.0.0.1:3000"
    export GOTRUE_EXTERNAL_EMAIL_ENABLED="true"
    export GOTRUE_EXTERNAL_PHONE_ENABLED="false"
    export GOTRUE_LOG_LEVEL="info"
    export GOTRUE_OPERATOR_TOKEN="local-dev-operator-token"
    ./auth migrate >>"$LOG" 2>&1
    setsid nohup ./auth serve >>"$LOG" 2>&1 < /dev/null &
  )
  wait_for "gotrue" 40 curl -sf http://127.0.0.1:9999/health
fi

keys="$(
  JWT_SECRET="$JWT_SECRET" node <<'JS'
const crypto = require("crypto");
const secret = process.env.JWT_SECRET;
function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
const now = Math.floor(Date.now() / 1000);
const claims = { iss: "supabase", iat: now, exp: now + 60 * 60 * 24 * 365 * 5 };
process.stdout.write(
  JSON.stringify({
    anon: jwt({ ...claims, role: "anon" }),
    service: jwt({ ...claims, role: "service_role" }),
  }),
);
JS
)"
ANON_KEY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).anon)' "$keys")"
SERVICE_KEY="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).service)' "$keys")"

umask 077
cat > apps/api/.env <<EOF
NODE_ENV=development
PORT=3001
DATABASE_URL=${DB_URL}
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_JWT_SECRET=${JWT_SECRET}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
LLM_PROVIDER=mock
INTEGRATION_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
EOF

cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
NEXT_PUBLIC_API_URL=http://localhost:3001
EOF

pnpm --filter @dentaltrack/api db:deploy
pnpm --filter @dentaltrack/api db:seed

create_body="$(
  node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2],email_confirm:true,user_metadata:{clinic_name:process.argv[3]}}))' \
    "$DEV_EMAIL" "$DEV_PASSWORD" "$DEV_CLINIC"
)"
create_code="$(
  curl -sS -o /tmp/dentaltrack-auth-user.json -w '%{http_code}' \
    http://127.0.0.1:54321/auth/v1/admin/users \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$create_body"
)"
case "$create_code" in
  200|201) ;;
  *)
    # Usuário da rodada anterior: garante a senha conhecida.
    user_id="$(
      curl -sS "http://127.0.0.1:54321/auth/v1/admin/users?filter=${DEV_EMAIL}" \
        -H "apikey: ${SERVICE_KEY}" \
        -H "Authorization: Bearer ${SERVICE_KEY}" \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);const u=(j.users||[]).find(x=>x.email===process.argv[1]);if(!u)process.exit(1);process.stdout.write(u.id);})' \
        "$DEV_EMAIL"
    )"
    curl -fsS -o /dev/null -X PUT "http://127.0.0.1:54321/auth/v1/admin/users/${user_id}" \
      -H "apikey: ${SERVICE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H 'Content-Type: application/json' \
      -d "$(node -e 'process.stdout.write(JSON.stringify({password:process.argv[1],email_confirm:true}))' "$DEV_PASSWORD")"
    ;;
esac

echo "start: postgres, auth e migrations prontos (web :3000, api :3001)"
