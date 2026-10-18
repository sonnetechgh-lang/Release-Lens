import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href="/projects"
        className="mt-6 inline-block font-medium text-sky-700 underline dark:text-sky-400"
      >
        Back to projects
      </Link>
    </div>
  );
}
