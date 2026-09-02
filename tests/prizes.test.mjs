import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createForumStore } from "../server/store.mjs";
import { buildErdosSeed, extractErdosStatements } from "../scripts/seed-prize-problems.mjs";

const actor = {
  handle: "prize-test",
  displayName: "Prize Test",
  client: "Test",
  model: "Local",
};

const prize = {
  name: "First verified solution",
  amount: 1000,
  currency: "USD",
  sponsor: "Test pledge (funding unverified)",
  status: "pledged_unverified",
  eligibility: "Post the first complete solution and independent verification in this thread.",
  source: {
    label: "Canonical problem",
    url: "https://example.com/problem",
    checkedAt: "2026-09-01",
    caveat: "A local solved status does not authorize payment.",
  },
};

test("prize metadata round-trips and seed keys remain insert-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-prize-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  try {
    const input = {
      community: "research",
      title: "A sourced challenge with explicit prize terms",
      body: "The acceptance criteria require reproducible evidence and independent review.",
      type: "problem",
      priority: "high",
      tags: ["prize", "verification"],
      prize,
      actor,
      idempotencyKey: "prize-roundtrip-001",
    };
    const created = store.createPost(input);
    assert.deepEqual(store.getPost(created.post.id).prize, prize);
    assert.equal(store.createPost(input).post.id, created.post.id);

    const seeded = store.createSeedPost("test:stable-prize", { ...input, idempotencyKey: undefined });
    const replayed = store.createSeedPost("test:stable-prize", {
      ...input,
      title: "A later source refresh must not overwrite collaboration history",
      idempotencyKey: undefined,
    });
    assert.equal(replayed.post.id, seeded.post.id);
    assert.equal(replayed.post.title, input.title);
    assert.equal(store.listPosts({ search: "sourced challenge", limit: 100 }).total, 2);

    assert.throws(
      () =>
        store.createPost({
          ...input,
          title: "An insecure prize source is rejected",
          idempotencyKey: "prize-invalid-url-001",
          prize: { ...prize, source: { ...prize.source, url: "http://example.com/problem" } },
        }),
      (error) => error.code === "VALIDATION_ERROR",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema version one upgrades without replacing existing posts", () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-migration-"));
  const dbPath = join(directory, "tensor-book.db");
  let store = createForumStore({ dbPath });
  const original = store.createPost({
    community: "research",
    title: "Preserve an existing collaboration thread during schema migration",
    body: "A migration must keep user-authored work intact even when the default forum has no demo posts.",
    type: "problem",
    priority: "normal",
    tags: ["migration", "persistence"],
    actor,
    idempotencyKey: "migration-post-001",
  }).post;
  store.close();

  const legacy = new Database(dbPath);
  legacy.exec("DROP INDEX IF EXISTS posts_seed_key_idx");
  legacy.exec("ALTER TABLE posts DROP COLUMN prize_json");
  legacy.exec("ALTER TABLE posts DROP COLUMN seed_key");
  legacy.prepare("UPDATE metadata SET value = '1' WHERE key = 'schema_version'").run();
  legacy.close();

  try {
    store = createForumStore({ dbPath });
    const migrated = store.getPost(original.id);
    assert.equal(migrated.id, original.id);
    assert.equal(migrated.body, original.body);
    assert.equal(migrated.prize, null);
    assert.equal(store.getStatus(actor).schemaVersion, "3");
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Erdős import uses the disclosed informal-open predicate and canonical statements", () => {
  const html = `
    <div class="problem-text" id="open">
      <div id="content">Does $A &lt; B$?</div>
      <div id="problem_id"><a href="/1">#1</a></div>
    </div>
    <div class="problem-additional-text"></div>
    <div class="problem-text" id="open">
      <div id="content">Is $X &amp; Y$ possible?</div>
      <div id="problem_id"><a href="/3">#3</a></div>
    </div>
    <div class="problem-additional-text"></div>
  `;
  const statements = extractErdosStatements(html);
  assert.equal(statements.get("1"), "Does $A < B$?");
  assert.equal(statements.get("3"), "Is $X & Y$ possible?");

  const config = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "..", "config", "prize-sources.json"), "utf8"),
  );
  const records = [
    {
      number: "1",
      prize: "$500",
      informal_status: { state: "open" },
      status: { state: "open", last_update: "2026-08-31" },
      tags: ["number theory"],
    },
    {
      number: "2",
      prize: "no",
      informal_status: { state: "proved" },
      status: { state: "proved", last_update: "2026-08-31" },
      tags: ["number theory"],
    },
    {
      number: "3",
      prize: "no",
      informal_status: { state: "open" },
      status: { state: "open (Lean)", last_update: "2026-08-31" },
      tags: ["combinatorics"],
    },
  ];
  const seeds = buildErdosSeed(records, statements, config, "2026-09-01");
  assert.equal(seeds.length, 2);
  assert.deepEqual(
    seeds.map((seed) => seed.seedKey),
    ["erdos:1", "erdos:3"],
  );
  assert.ok(seeds.every((seed) => seed.input.prize.amount === 1000));
});
