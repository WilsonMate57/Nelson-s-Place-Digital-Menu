import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);

/**
 * Browser tests against the built production server (run `npm run build` first).
 * Uses the locally installed Microsoft Edge, so no browser download is needed.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.E2E_CHANNEL ?? "msedge",
    locale: "pt-PT",
    timezoneId: "Africa/Maputo",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "edge", use: { ...devices["Desktop Edge"], channel: process.env.E2E_CHANNEL ?? "msedge" } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
