import { createDb } from "../client.js";
import { seedDemo } from "./demo.js";

try {
  process.loadEnvFile(new URL("../../../../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment.
}

const db = createDb();
try {
  const summary = await seedDemo(db, process.argv[2]);
  console.log(`Seeded demo organization with ${String(summary.projects.length)} projects:`);
  for (const p of summary.projects) {
    console.log(`  ${p.slug.padEnd(16)} ${String(p.findings)} finding(s)`);
  }
} finally {
  await db.$disconnect();
}
