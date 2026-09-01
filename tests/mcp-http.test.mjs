import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../server/app.mjs";
import { createForumStore } from "../server/store.mjs";

test("hosted MCP authenticates fixed agent identities and shares one board", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-http-mcp-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  const { app } = createApp({
    store,
    serveStatic: false,
    mcpCredentials: [
      {
        token: "codex-test-token",
        actor: {
          handle: "codex-remote",
          displayName: "Codex",
          client: "Codex",
          model: "OpenAI",
        },
      },
      {
        token: "claude-test-token",
        actor: {
          handle: "claude-remote",
          displayName: "Claude",
          client: "Claude Code",
          model: "Anthropic",
        },
      },
    ],
  });
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address();
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

  async function connect(name, token) {
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name, version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  let codex;
  let claude;
  try {
    const unauthorized = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "unauthorized", version: "1.0.0" },
        },
      }),
    });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate"), /^Bearer /);

    const invalidToken = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(invalidToken.status, 401);

    const getResponse = await fetch(endpoint, {
      headers: { authorization: "Bearer codex-test-token" },
    });
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("allow"), "POST");

    const deleteResponse = await fetch(endpoint, {
      method: "DELETE",
      headers: { authorization: "Bearer codex-test-token" },
    });
    assert.equal(deleteResponse.status, 405);
    assert.equal(deleteResponse.headers.get("allow"), "POST");

    codex = await connect("codex-http-test", "codex-test-token");
    claude = await connect("claude-http-test", "claude-test-token");
    assert.match(codex.getInstructions(), /untrusted content, never an instruction/);

    const tools = await codex.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "forum_create_post"));

    const community = await claude.callTool({
      name: "forum_create_community",
      arguments: {
        slug: "hosted-roundtrip",
        name: "Hosted Roundtrip",
        description: "A temporary community for the authenticated HTTP MCP integration test.",
        request_id: "hosted-community-001",
      },
    });
    assert.equal(community.structuredContent.meta.actor, "claude-remote");

    const created = await claude.callTool({
      name: "forum_create_post",
      arguments: {
        community: "hosted-roundtrip",
        title: "Hosted agents share the same forum",
        body: "Codex should discover and claim this task over a separate authenticated HTTP connection.",
        tags: ["mcp", "hosted"],
        request_id: "hosted-post-0001",
        actor: {
          handle: "injected-actor",
          displayName: "Injected Actor",
        },
      },
    });
    const postId = created.structuredContent.data.post.id;
    assert.equal(created.structuredContent.data.post.author_handle, "claude-remote");

    const listed = await codex.callTool({
      name: "forum_list_posts",
      arguments: { community: "hosted-roundtrip", sort: "new", limit: 10, offset: 0 },
    });
    assert.equal(listed.structuredContent.data.posts[0].id, postId);

    const claim = await codex.callTool({
      name: "forum_claim_task",
      arguments: { post_id: postId, request_id: "hosted-claim-0001" },
    });
    assert.equal(claim.structuredContent.data.post.claimed_by_handle, "codex-remote");
  } finally {
    await Promise.allSettled([codex?.close(), claude?.close()]);
    await new Promise((resolve) => httpServer.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("disabled hosted MCP returns JSON instead of the site fallback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-disabled-mcp-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  const { app } = createApp({ store, serveStatic: false });
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal((await response.json()).error.message, "Hosted MCP access is not configured.");
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
