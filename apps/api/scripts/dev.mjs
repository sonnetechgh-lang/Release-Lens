// Development runner: recompiles on change and restarts the server.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const tsc = spawn(
  "pnpm",
  ["exec", "tsc", "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
while (!existsSync("dist/main.js")) await sleep(250);
const server = spawn(process.execPath, ["--watch", "dist/main.js"], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    tsc.kill();
    server.kill();
    process.exit(0);
  });
}
