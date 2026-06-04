# DentalTrack API (NestJS) — imagem de produção.
# Build context = RAIZ do repositório (precisa de packages/shared + pnpm-workspace).
# Railway/Render/Fly: Dockerfile path = apps/api/Dockerfile · context = .
FROM node:24-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dentaltrack/shared build && pnpm --filter @dentaltrack/api build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
