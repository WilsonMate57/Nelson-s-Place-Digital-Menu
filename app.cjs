// Startup file for Plesk (Phusion Passenger).
// Passenger loads the startup file with require(), so this CommonJS wrapper
// imports the ES-module server build. Run `npm run build` before starting.

// Configuration from <app root>/.env (outside the web root) when present.
// Variables already set in the environment take precedence.
try {
  process.loadEnvFile(`${__dirname}/.env`);
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

import("./dist/server/index.js").catch((err) => {
  console.error("Failed to start Nelson's Place menu server:", err);
  process.exit(1);
});
