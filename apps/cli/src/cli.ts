import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseSnapshot } from "@releaselens/contracts";
import { diagnose, renderMarkdownReport } from "@releaselens/diagnostics";

export const USAGE = `Usage: releaselens diagnose <snapshot.json | scenario-directory> [--format markdown|json]

Runs the ReleaseLens diagnostic rules against an evidence snapshot and prints the findings.
If a directory is given, its snapshot.json is used.

Options:
  --format <markdown|json>  Output format (default: markdown)
  -h, --help                Show this help

Exit codes: 0 = ran successfully (findings or not), 1 = invalid input, 2 = usage error.`;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

/** Runs the CLI and returns the exit code. Kept free of process globals so it can be tested. */
export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "markdown" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }

  const [command, target, ...extra] = positionals;
  if (command !== "diagnose" || target === undefined || extra.length > 0) {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  if (values.format !== "markdown" && values.format !== "json") {
    io.stderr(`Unknown format "${values.format}". Use markdown or json.\n`);
    return 2;
  }

  let file = path.resolve(io.cwd, target);
  let raw: string;
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "snapshot.json");
    raw = await readFile(file, "utf8");
  } catch {
    io.stderr(`Cannot read ${file}\n`);
    return 1;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    io.stderr(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  const result = parseSnapshot(json);
  if (!result.success) {
    io.stderr(`${file} is not a valid snapshot:\n${result.error}\n`);
    return 1;
  }

  const findings = diagnose(result.snapshot);
  io.stdout(
    values.format === "json"
      ? `${JSON.stringify({ evaluatedAt: result.snapshot.evaluatedAt, findings }, null, 2)}\n`
      : renderMarkdownReport(result.snapshot, findings),
  );
  return 0;
}
