import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN_USER_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const PRIVATE_KEY = readFileSync(
  path.resolve(process.cwd(), "..", ".dev-secrets", "jwt-private.pem"),
  "utf8",
);

export const adminPermissions = ["*", "lex:*", "workflows:*"];

export function mintE2EToken(input: {
  userId?: string;
  email: string;
  fullName?: string;
  roles: string[];
  permissions: string[];
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const userId = input.userId ?? randomUUID();
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: "clario360",
    sub: userId,
    uid: userId,
    tid: TENANT_ID,
    tenant_id: TENANT_ID,
    email: input.email,
    ...(input.fullName ? { full_name: input.fullName } : {}),
    roles: input.roles,
    perms: input.permissions,
    permissions: input.permissions,
    sid: randomUUID(),
    jti: randomUUID(),
    iat: now,
    nbf: now - 10,
    exp: now + (input.ttlSeconds ?? 8 * 60 * 60),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(PRIVATE_KEY);
  return `${signingInput}.${base64url(signature)}`;
}

export function mintAdminToken(): string {
  return mintE2EToken({
    userId: ADMIN_USER_ID,
    email: "admin@clario.dev",
    roles: [
      "super-admin",
      "tenant-admin",
      "admin",
      "legal-system-admin",
      "legal-director",
      "legal-dept-manager",
    ],
    permissions: adminPermissions,
  });
}

export async function signInWithToken(
  pageOrRequest: Page | APIRequestContext,
  baseURL: string | undefined,
  token: string,
): Promise<void> {
  const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
  if ("context" in pageOrRequest) {
    await pageOrRequest.context().addCookies([
      {
        name: "clario360_locale",
        value: "en",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);
  }
  const request =
    "request" in pageOrRequest ? pageOrRequest.request : pageOrRequest;
  const response = await request.post(`${appOrigin}/api/auth/session`, {
    data: { access_token: token, refresh_token: token, remember: true },
    headers: {
      Origin: appOrigin,
      Referer: `${appOrigin}/login`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
