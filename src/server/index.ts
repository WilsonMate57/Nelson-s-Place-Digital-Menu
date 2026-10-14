import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { createApp, createServices } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/connection";

const config = loadConfig();
const db = openDatabase(config.databasePath);
mkdirSync(config.uploadsDir, { recursive: true });
const services = createServices(config, db);
const app = createApp(services);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Nelson's Place menu server listening on http://${info.address}:${info.port} ` +
      `(env=${config.env}, whatsapp=${config.whatsapp.mode}, db=${config.databasePath})`,
  );
  if (services.staffRepo.countActiveWith("staff.manage") === 0) {
    console.warn("No active administrator exists yet. Create one with: npm run admin:create");
  }
});

// Daily summary to the manager: check every 5 minutes whether it is due.
const summaryTimer = setInterval(() => {
  services.dailySummary.tick().catch((err: unknown) => console.error("Daily summary check failed", err));
}, 5 * 60_000);
summaryTimer.unref();

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
