// Runs the API server (tsx watch) and the Vite dev server together.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = ["dev:server", "dev:client"].map((script) =>
  spawn(npm, ["run", script], { stdio: "inherit", shell: process.platform === "win32" }),
);
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) => c.on("exit", (code) => { if (code) { stop(); process.exit(code); } }));
