import { runMigrations, closePool } from "./db.js";

async function main() {
  console.log("[Migrate] Running database migrations...");
  await runMigrations();
  console.log("[Migrate] ✅ All migrations complete");
  await closePool();
}

main().catch((err) => {
  console.error("[Migrate] Fatal error:", err);
  process.exit(1);
});
