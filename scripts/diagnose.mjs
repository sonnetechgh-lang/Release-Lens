// Builds the CLI and its dependencies (cached by Turborepo), then runs
// `releaselens diagnose` with the given arguments. Build output goes to stderr
// so stdout stays clean, e.g. for `--format json`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", "build", "--filter=@releaselens/cli...", "--output-logs=errors-only"],
  {
    cwd: root,
    stdio: ["ignore", process.stderr, process.stderr],
    shell: process.platform === "win32",
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const cli = spawnSync(
  process.execPath,
  [`${root}apps/cli/dist/main.js`, "diagnose", ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
process.exit(cli.status ?? 1);
