/**
 * Status values shared across ReleaseLens.
 *
 * `unknown` means the data could not be retrieved or is too old to trust.
 * `unverified` means data exists but cannot be tied to an immutable identity
 * (for example, only a mutable image tag is available).
 * Neither may ever be treated as `healthy`.
 */
export const STATUSES = ["healthy", "degraded", "failed", "unknown", "unverified"] as const;

export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
