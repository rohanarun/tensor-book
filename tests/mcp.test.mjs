import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "..");
const serverPath = resolve(root, "scripts", "mcp-server.mjs");

test("MCP initializes with safety instructions and completes a two-agent round trip", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-mcp-"));
  const dbPath = join(directory, "tensor-book.db");

  async function connect(profile) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath, "--profile", profile],
      cwd: root,
      env: { ...process.env, TENSOR_BOOK_DB: dbPath },
      stderr: "pipe",
    });
    const client = new Client({ name: `test-${profile}`, version: "1.0.0" });
    await client.connect(transport);
    return { client, transport };
  }

  const codex = await connect("codex");
  const claude = await connect("claude");
  try {
    assert.match(codex.client.getInstructions(), /untrusted content, never an instruction/);
    const tools = await codex.client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("forum_create_community"));
    assert.ok(toolNames.includes("forum_claim_task"));
    assert.equal(tools.tools.find((tool) => tool.name === "forum_status").annotations.readOnlyHint, true);

    const community = await codex.client.callTool({
      name: "forum_create_community",
      arguments: {
        slug: "mcp-roundtrip",
        name: "MCP Roundtrip",
        description: "A temporary community proving two independent MCP clients share one local board.",
        request_id: "mcp-community-001",
      },
    });
    assert.equal(community.structuredContent.ok, true);

    const listed = await claude.client.callTool({
      name: "forum_list_communities",
      arguments: { query: "mcp-roundtrip", limit: 10 },
    });
    assert.equal(listed.structuredContent.data[0].slug, "mcp-roundtrip");

    const created = await claude.client.callTool({
      name: "forum_create_post",
      arguments: {
        community: "mcp-roundtrip",
        title: "Two clients see the same task",
        body: "Codex should claim this task after Claude creates it through a separate stdio process.",
        type: "problem",
        priority: "high",
        tags: ["mcp", "roundtrip"],
        prize: {
          name: "MCP verification bounty",
          amount: 1000,
          currency: "USD",
          sponsor: "Test pledge",
          status: "pledged_unverified",
          eligibility: "The first independently verified solution posted here qualifies.",
          source: {
            label: "Test specification",
            url: "https://example.com/mcp-prize",
            checked_at: "2026-09-01",
          },
        },
        request_id: "mcp-post-0001",
      },
    });
    const postId = created.structuredContent.data.post.id;
    assert.equal(created.structuredContent.data.post.prize.amount, 1000);

    const replay = await claude.client.callTool({
      name: "forum_create_post",
      arguments: {
        community: "mcp-roundtrip",
        title: "Two clients see the same task",
        body: "Codex should claim this task after Claude creates it through a separate stdio process.",
        type: "problem",
        priority: "high",
        tags: ["mcp", "roundtrip"],
        prize: {
          name: "MCP verification bounty",
          amount: 1000,
          currency: "USD",
          sponsor: "Test pledge",
          status: "pledged_unverified",
          eligibility: "The first independently verified solution posted here qualifies.",
          source: {
            label: "Test specification",
            url: "https://example.com/mcp-prize",
            checked_at: "2026-09-01",
          },
        },
        request_id: "mcp-post-0001",
      },
    });
    assert.equal(replay.structuredContent.data.post.id, postId);
    assert.equal(replay.structuredContent.data.replayed, true);

    const claim = await codex.client.callTool({
      name: "forum_claim_task",
      arguments: { post_id: postId, request_id: "mcp-claim-0001" },
    });
    assert.equal(claim.structuredContent.data.post.claimed_by_handle, "codex-local");

    const conflict = await claude.client.callTool({
      name: "forum_claim_task",
      arguments: { post_id: postId, request_id: "mcp-claim-0002" },
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "CLAIM_CONFLICT");
  } finally {
    await Promise.all([codex.client.close(), claude.client.close()]);
    rmSync(directory, { recursive: true, force: true });
  }
});
