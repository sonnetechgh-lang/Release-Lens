/** Placeholder written in place of anything secret. */
export const REDACTED = "[REDACTED]";

/** Object keys whose values are always redacted, whatever they contain. */
const SENSITIVE_KEY =
  /pass(word|wd)?$|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|connection[-_]?string|^sig$|signature/i;

interface Pattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly replace: string;
}

/**
 * Patterns for secrets that show up inside free text (log lines, error messages).
 * Order matters: specific token formats run before the generic key=value rule.
 */
const PATTERNS: readonly Pattern[] = [
  {
    name: "private-key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: REDACTED,
  },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g, replace: REDACTED },
  { name: "github-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, replace: REDACTED },
  { name: "slack-token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: "aws-access-key", regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: REDACTED,
  },
  {
    name: "auth-header",
    regex: /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: `$1 ${REDACTED}`,
  },
  {
    // scheme://user:password@host  ->  scheme://user:[REDACTED]@host
    name: "url-credentials",
    regex: /\b([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@/\s]+)@/gi,
    replace: `$1$2:${REDACTED}@`,
  },
  {
    // password=..., client_secret: ..., AccountKey=...; sig=... (SAS tokens)
    name: "key-value",
    regex:
      /\b(password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|token|sig)(["']?\s*[=:]\s*["']?)([^\s"'&;,]+)/gi,
    replace: `$1$2${REDACTED}`,
  },
];

/** Replaces secret-looking substrings in free text. */
export function redactString(text: string): string {
  let out = text;
  for (const { regex, replace } of PATTERNS) out = out.replace(regex, replace);
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

const MAX_DEPTH = 10;

/**
 * Returns a deep copy of `value` with secrets removed:
 * values under sensitive keys are replaced, and strings are scanned for secret patterns.
 * Never mutates the input. Cycles and very deep nesting are cut off.
 */
export function redact<T>(value: T): T {
  return redactValue(value, 0, new WeakSet()) as T;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, depth + 1, seen);
  }
  return out;
}

/** Redacts and shortens text for storage, e.g. a health-check response body. */
export function boundedExcerpt(text: string, maxLength = 500): string {
  const clean = redactString(text);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}… [truncated]`;
}
