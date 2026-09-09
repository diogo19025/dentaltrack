import { describe, expect, it } from "vitest";
import { sessionIdFromToken } from "./session-id";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(claims))}.assinatura`;
}

describe("sessionIdFromToken", () => {
  it("lê o session_id do access token do Supabase", () => {
    expect(sessionIdFromToken(jwt({ sub: "u1", session_id: "sess-abc" }))).toBe("sess-abc");
  });

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["sem payload", "abc"],
    ["payload que não é JSON", "a.b.c"],
    ["sem o claim", jwt({ sub: "u1" })],
  ])("devolve null para token %s", (_caso, token) => {
    expect(sessionIdFromToken(token)).toBeNull();
  });
});
