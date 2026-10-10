// Starts the built production server on a fresh, throwaway database for browser tests.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const dir = mkdtempSync(join(tmpdir(), "np-e2e-"));
const env = {
  ...process.env,
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: process.env.E2E_PORT ?? "3200",
  DATABASE_PATH: join(dir, "e2e.db"),
  UPLOADS_DIR: join(dir, "uploads"),
  COOKIE_SECURE: "false",
  ADMIN_PASSWORD: "e2e-admin-password",
};
const run = (script, args = []) => execFileSync(process.execPath, [script, ...args], { env, stdio: ["ignore", "inherit", "inherit"] });
run("dist/server/cli/seed-demo.js", ["--force-production"]);
run("dist/server/cli/create-admin.js", ["--email", "admin@e2e.local", "--name", "Admin E2E"]);
const server = spawn(process.execPath, ["dist/server/index.js"], { env, stdio: "inherit" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
