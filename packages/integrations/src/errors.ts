/**
 * Why a provider call failed, as a category. Only the category is ever stored or
 * shown, never the raw provider message, so tokens or internal details cannot leak.
 * Matches `SyncStatusEvidence["lastErrorKind"]` in @releaselens/contracts.
 */
export type ProviderErrorKind =
  | "timeout"
  | "rate-limited"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "server-error"
  | "network";

const RETRYABLE = new Set<ProviderErrorKind>([
  "timeout",
  "rate-limited",
  "server-error",
  "network",
]);

export class ProviderError extends Error {
  override readonly name = "ProviderError";

  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    /** When the provider says how long to wait (rate limits). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }

  /** Worth retrying later: the same request may succeed. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

/** Maps a failed fetch (thrown error) to a ProviderError. */
export function fromFetchError(error: unknown, what: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new ProviderError("timeout", `${what} timed out`);
  }
  return new ProviderError("network", `${what} failed: network error`);
}
