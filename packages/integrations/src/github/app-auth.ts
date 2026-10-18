import { createPrivateKey, sign } from "node:crypto";

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/**
 * Creates the short-lived JWT a GitHub App uses to authenticate as itself.
 * Valid for 9 minutes (GitHub allows 10); issued 60 seconds in the past to
 * tolerate clock drift.
 */
export function createAppJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const key = createPrivateKey(privateKeyPem);
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${base64url(signature)}`;
}
