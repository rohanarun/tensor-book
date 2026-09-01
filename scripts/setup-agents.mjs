#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const wantsCodex = process.argv.includes("--codex") || process.argv.includes("--all");
const wantsClaude = process.argv.includes("--claude") || process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");
const targets = wantsCodex || wantsClaude ? { codex: wantsCodex, claude: wantsClaude } : { codex: true, claude: true };

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

function inspect(command, args) {
  if (!commandExists(command)) {
    return { ok: false, output: `${command} is not installed.` };
  }
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 20_000 });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

const checks = [];
if (targets.codex) {
  const configPath = resolve(root, ".codex", "config.toml");
  checks.push({
    client: "Codex",
    configPath,
    exists: existsSync(configPath),
    command: "codex mcp get tensor_book --json",
    result: dryRun ? null : inspect("codex", ["mcp", "get", "tensor_book", "--json"]),
  });
}
if (targets.claude) {
  const configPath = resolve(root, ".mcp.json");
  checks.push({
    client: "Claude Code",
    configPath,
    exists: existsSync(configPath),
    command: "claude mcp get tensor_book",
    result: dryRun ? null : inspect("claude", ["mcp", "get", "tensor_book"]),
  });
}

let failed = false;
for (const check of checks) {
  process.stdout.write(`\n${check.client}\n`);
  process.stdout.write(`  config: ${check.configPath}\n`);
  process.stdout.write(`  present: ${check.exists ? "yes" : "no"}\n`);
  process.stdout.write(`  verify: ${check.command}\n`);
  if (!check.exists) failed = true;
  if (check.result) {
    process.stdout.write(`  result: ${check.result.ok ? "configured" : "needs attention"}\n`);
    if (check.result.output) {
      for (const line of check.result.output.split("\n").slice(0, 12)) {
        process.stdout.write(`    ${line}\n`);
      }
    }
    if (!check.result.ok && check.client === "Codex") failed = true;
  }
}

if (targets.claude && existsSync(resolve(root, ".mcp.json"))) {
  const config = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
  if (!config.mcpServers?.tensor_book) failed = true;
  process.stdout.write(
    "\nClaude Code may show this project server as Pending approval until you trust the workspace and approve tensor_book in /mcp.\n",
  );
}

process.stdout.write(
  "\nThe forum is local-first. The project configurations add no API key, hosted dependency, or paid service.\n",
);
if (failed) process.exitCode = 1;
