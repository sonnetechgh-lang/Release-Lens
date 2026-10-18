import { loadWorkerConfig } from "./config.js";
import { createLogger, startWorker } from "./worker.js";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}

const config = loadWorkerConfig();
const log = createLogger(config);
const worker = await startWorker(config, log);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "Shutting down: finishing active jobs");
    worker
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        log.error({ err: error }, "Shutdown failed");
        process.exit(1);
      });
  });
}
