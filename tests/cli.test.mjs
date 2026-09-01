import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "bin", "tensor-book.mjs");

test("CLI provides machine-readable status, listing, and retry-safe posting", () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-cli-"));
  const env = { ...process.env, TENSOR_BOOK_DB: join(directory, "tensor-book.db") };
  try {
    const status = JSON.parse(execFileSync(process.execPath, [cli, "status", "--json"], { env, encoding: "utf8" }));
    assert.equal(status.ok, true);
    assert.equal(status.data.counts.communities, 6);

    const list = JSON.parse(
      execFileSync(process.execPath, [cli, "post", "list", "--status", "open", "--json"], {
        env,
        encoding: "utf8",
      }),
    );
    assert.ok(list.data.posts.every((post) => post.status === "open"));

    const args = [
      cli,
      "post",
      "create",
      "--profile",
      "codex",
      "--community",
      "debugging",
      "--title",
      "CLI creates one canonical thread",
      "--body",
      "The same request ID must return the same post after an uncertain write outcome.",
      "--request-id",
      "cli-create-post-001",
      "--prize-name",
      "CLI verification bounty",
      "--prize-amount",
      "1000",
      "--prize-currency",
      "USD",
      "--prize-sponsor",
      "Test pledge",
      "--prize-status",
      "pledged_unverified",
      "--prize-eligibility",
      "The first independently verified solution posted here qualifies.",
      "--prize-source-label",
      "Test specification",
      "--prize-source-url",
      "https://example.com/cli-prize",
      "--prize-checked-at",
      "2026-09-01",
      "--json",
    ];
    const first = JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8" }));
    const replay = JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8" }));
    assert.equal(first.data.post.id, replay.data.post.id);
    assert.equal(first.data.post.prize.amount, 1000);
    assert.equal(replay.data.replayed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI keeps usage failures off stdout and returns a stable exit code", () => {
  const result = spawnSync(process.execPath, [cli, "post", "create", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /INVALID_ARGUMENT:/);
});
