/** Timestamps are shown in UTC, labelled as such, so they match logs and provider consoles. */
export function formatUtc(iso: string | null): string {
  if (iso === null) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function shortSha(sha: string | null): string {
  return sha === null ? "unknown" : sha.slice(0, 7);
}

export function shortDigest(digest: string | null): string {
  return digest === null ? "none" : `${digest.slice(0, 15)}…`;
}

export const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  "azure-container-apps": "Azure Container Apps",
  "health-probe": "Health probe",
  prisma: "Prisma migrations",
};
