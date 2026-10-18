import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * Server-side GET against the ReleaseLens API, forwarding the visitor's session cookie.
 * 401 sends the visitor to sign-in; 404 renders the not-found page.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) redirect("/sign-in");
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API request failed with status ${String(res.status)}`);
  return (await res.json()) as T;
}

/** Like apiGet, but returns null instead of redirecting when the visitor is signed out. */
export async function apiGetOptional<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API request failed with status ${String(res.status)}`);
  return (await res.json()) as T;
}
