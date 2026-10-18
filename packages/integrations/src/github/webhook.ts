import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks GitHub's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body).
 * Must run on the exact bytes received, before any JSON parsing.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (secret === "" || signatureHeader === undefined || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Computes a signature header. Used by tests and local tooling. */
export function signWebhookBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
