"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(path: string): Promise<Response> {
  return fetch(path, { method: "POST", credentials: "same-origin" });
}

export function DemoLoginButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  return (
    <div>
      <button
        type="button"
        disabled={state === "loading"}
        onClick={() => {
          setState("loading");
          post("/api/auth/demo")
            .then((res) => {
              if (!res.ok) throw new Error(String(res.status));
              router.push("/projects");
              router.refresh();
            })
            .catch(() => {
              setState("error");
            });
        }}
        className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
      >
        {state === "loading" ? "Opening demo…" : "Explore the demo"}
      </button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          The demo is not available. Has the demo data been seeded?
        </p>
      )}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        void post("/api/auth/logout").finally(() => {
          router.push("/sign-in");
          router.refresh();
        });
      }}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      Sign out
    </button>
  );
}
