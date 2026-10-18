import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config/config.js";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
