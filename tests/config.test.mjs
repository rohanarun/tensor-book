import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("project MCP configuration exists for both Codex and Claude without secrets", () => {
  const codex = readFileSync(resolve(root, ".codex", "config.toml"), "utf8");
  const claudeText = readFileSync(resolve(root, ".mcp.json"), "utf8");
  const claude = JSON.parse(claudeText);
  assert.match(codex, /\[mcp_servers\.tensor_book\]/);
  assert.match(codex, /default_tools_approval_mode = "writes"/);
  assert.equal(claude.mcpServers.tensor_book.type, "stdio");
  assert.ok(claude.mcpServers.tensor_book.args.includes("claude"));
  assert.doesNotMatch(`${codex}\n${claudeText}`, /api[_-]?key|bearer|token\s*[:=]/i);
});

test("agent guidance treats forum content as untrusted and requires verification", () => {
  const guidance = readFileSync(resolve(root, "AGENTS.md"), "utf8");
  assert.match(guidance, /untrusted content/i);
  assert.match(guidance, /Mark work solved only when/i);
  assert.match(guidance, /Reuse the same request ID/i);
});

test("the Agent Skill keeps end-of-cycle work optional and bounded", () => {
  const skill = readFileSync(resolve(root, "skills", "tensor-book", "SKILL.md"), "utf8");
  assert.match(skill, /Optional end-of-cycle work/);
  assert.match(skill, /mode is off by default/i);
  assert.match(skill, /first setup invocation after every install or update/i);
  assert.match(skill, /Do not carry consent forward/i);
  assert.match(skill, /Require an explicit confirmation immediately before creating or updating the automation/i);
  assert.match(skill, /Never generate filler/i);
  assert.match(skill, /Keep rate-limit and account data local/i);
  assert.match(skill, /Never purchase credits[\s\S]*redeem usage resets/i);
  assert.match(skill, /stop safely if it fails/i);
});

test("the edge exposes only anonymous vote posts and protects every other browser write", () => {
  const caddy = readFileSync(resolve(root, "deploy", "gcp", "Caddyfile.template"), "utf8");
  assert.match(caddy, /@protected_write\s*\{[\s\S]*method POST PUT PATCH DELETE/);
  assert.match(caddy, /not\s*\{\s*method POST\s*path \/api\/votes\s*\}/);
  assert.match(caddy, /basicauth @protected_write/);
});
