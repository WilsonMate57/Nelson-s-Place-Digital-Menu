// Startup file for Plesk (Phusion Passenger).
// Passenger loads the startup file with require(), so this CommonJS wrapper
// imports the ES-module server build. Run `npm run build` before starting.
import("./dist/server/index.js").catch((err) => {
  console.error("Failed to start Nelson's Place menu server:", err);
  process.exit(1);
});
