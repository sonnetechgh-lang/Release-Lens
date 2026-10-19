import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const DB_PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));

const PRISMA_CLI = fileURLToPath(
  new URL("../../node_modules/prisma/build/index.js", import.meta.url),
);

/** Runs the Prisma CLI with node directly; going through npx is much slower on Windows. */
function prisma(args: string[], databaseUrl: string, input?: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: DB_PACKAGE_DIR,
    // No update check: it can stall the CLI on a slow network.
    env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: "1" },
    input: input ?? "",
    stdio: "pipe",
    timeout: 300_000,
  });
}

/** Applies the real migrations to an empty database. */
export function migrate(databaseUrl: string): void {
  prisma(["migrate", "deploy"], databaseUrl);
}

/**
 * Integration tests normally start throwaway containers. On a machine where that
 * is too slow, set RELEASELENS_TEST_POSTGRES_URL (and RELEASELENS_TEST_REDIS_URL)
 * to servers that are already running, e.g. the docker compose ones. Each test
 * suite then gets its own database, `releaselens_<suite>_test`, which is wiped
 * first; no other database is touched. Returns null when the variables are unset.
 */
export function externalDatabase(suite: string): string | null {
  const server = process.env.RELEASELENS_TEST_POSTGRES_URL;
  if (server === undefined || server === "") return null;
  const url = new URL(server);
  const name = `releaselens_${suite}_test`;
  try {
    // Run against the database named in the URL, which must exist.
    prisma(["db", "execute", "--stdin"], server, `CREATE DATABASE "${name}";`);
  } catch {
    // Already exists.
  }
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  prisma(
    ["db", "execute", "--stdin"],
    databaseUrl,
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
  );
  migrate(databaseUrl);
  return databaseUrl;
}

/**
 * Like externalDatabase, for Redis: the suite uses its own logical database
 * (`index`), which is flushed first. Never use index 0, the default for the app.
 */
export async function externalRedis(index: number): Promise<string | null> {
  const server = process.env.RELEASELENS_TEST_REDIS_URL;
  if (server === undefined || server === "") return null;
  if (index < 1 || index > 15) throw new Error("Use a Redis database index from 1 to 15");
  const url = new URL(server);
  url.pathname = `/${String(index)}`;
  await new Promise<void>((resolve, reject) => {
    const socket = connect(Number(url.port || 6379), url.hostname, () => {
      socket.write(`SELECT ${String(index)}\r\nFLUSHDB\r\n`);
    });
    let replies = "";
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error("Redis did not answer"));
    });
    socket.on("data", (chunk) => {
      replies += chunk.toString();
      if ((replies.match(/\r\n/g) ?? []).length >= 2) {
        socket.end();
        if (replies.includes("-ERR")) reject(new Error(`Redis refused: ${replies.trim()}`));
        else resolve();
      }
    });
    socket.on("error", reject);
  });
  return url.toString();
}
