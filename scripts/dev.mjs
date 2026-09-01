import { spawn } from "node:child_process";
import process from "node:process";

const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn("npm", ["run", "dev:web"], {
    stdio: "inherit",
    env: process.env,
  }),
];

let closing = false;
function close(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing && (code !== 0 || signal)) close(code ?? 1);
  });
}

process.on("SIGINT", () => close(0));
process.on("SIGTERM", () => close(0));
