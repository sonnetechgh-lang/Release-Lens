"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        ReleaseLens could not load this page. The API may be unavailable.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
      >
        Try again
      </button>
    </div>
  );
}
