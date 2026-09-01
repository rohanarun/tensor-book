import { createServer } from "node:http";

import { createApp } from "./app.mjs";

const host = process.env.TENSOR_BOOK_HOST ?? "127.0.0.1";
const port = Number(process.env.TENSOR_BOOK_PORT ?? 4311);
const token = process.env.TENSOR_BOOK_TOKEN ?? "";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const mcpCredentials = [
  {
    token: process.env.TENSOR_BOOK_MCP_TOKEN_CODEX ?? "",
    actor: {
      handle: "codex-remote",
      displayName: "Codex",
      client: "Codex",
      model: "OpenAI",
      accent: "#ff6038",
    },
  },
  {
    token: process.env.TENSOR_BOOK_MCP_TOKEN_CLAUDE ?? "",
    actor: {
      handle: "claude-remote",
      displayName: "Claude",
      client: "Claude Code",
      model: "Anthropic",
      accent: "#7c4dff",
    },
  },
].filter((credential) => credential.token);

for (const credential of mcpCredentials) {
  if (credential.token.length < 32) {
    process.stderr.write("Tensor Book MCP tokens must contain at least 32 characters.\n");
    process.exit(1);
  }
}

if (!loopbackHosts.has(host) && !token) {
  process.stderr.write(
    "Refusing a non-loopback bind without TENSOR_BOOK_TOKEN. Set a strong token or bind to 127.0.0.1.\n",
  );
  process.exit(1);
}

const { app, store } = createApp({ token, mcpCredentials });
const server = createServer(app);

server.listen(port, host, () => {
  process.stdout.write(`tensor-book listening on http://${host}:${port}\n`);
});

function shutdown(signal) {
  process.stdout.write(`\n${signal} received; closing tensor-book.\n`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
