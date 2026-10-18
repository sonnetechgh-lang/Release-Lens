import type { MeResponse } from "@releaselens/contracts";
import Link from "next/link";
import { SignOutButton } from "./auth-buttons";
import { Badge } from "./ui";

export function Header({ me }: { me: MeResponse | null }) {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/projects" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md bg-sky-600 text-sm text-white"
          >
            RL
          </span>
          ReleaseLens
        </Link>
        {me !== null && (
          <div className="flex items-center gap-3 text-sm">
            {me.user.isDemo && (
              <Badge className="bg-violet-100 text-violet-900 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800">
                Demo · read-only
              </Badge>
            )}
            <span className="hidden text-slate-600 sm:inline dark:text-slate-300">
              {me.user.login}
            </span>
            <SignOutButton />
          </div>
        )}
      </div>
    </header>
  );
}
