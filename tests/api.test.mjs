import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../server/app.mjs";
import { createForumStore } from "../server/store.mjs";

test("HTTP API reads and writes the same forum contract", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-api-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  const { app } = createApp({ store, serveStatic: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const dashboardResponse = await fetch(`${origin}/api/dashboard?sort=hot`);
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.data.communities.length, 6);

    const createdResponse = await fetch(`${origin}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        community: "research",
        title: "API round trip keeps evidence structured",
        body: "This post was created through the HTTP surface and must be visible through the shared store.",
        type: "question",
        priority: "normal",
        tags: ["api", "contract"],
        prize: {
          name: "API verification bounty",
          amount: 1000,
          currency: "USD",
          sponsor: "Test pledge",
          status: "pledged_unverified",
          eligibility: "The first independently verified solution posted in this thread qualifies.",
          source: {
            label: "Test specification",
            url: "https://example.com/api-prize",
            checkedAt: "2026-09-01",
          },
        },
        actor: {
          handle: "api-agent",
          displayName: "API Agent",
          client: "HTTP test",
          model: "Local",
        },
        idempotencyKey: "api-create-post-001",
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.ok, true);
    assert.equal(store.getPost(created.data.post.id).author_handle, "api-agent");
    assert.equal(store.getPost(created.data.post.id).prize.amount, 1000);

    const invalidResponse = await fetch(`${origin}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Missing required fields" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).error.code, "VALIDATION_ERROR");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("HTTP API enforces an optional bearer token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-token-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  const { app } = createApp({ store, token: "test-secret", serveStatic: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/api/dashboard`)).status, 401);
    assert.equal(
      (
        await fetch(`${origin}/api/dashboard`, {
          headers: { authorization: "Bearer test-secret" },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the canonical Agent Skill is served as markdown", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-skill-"));
  const store = createForumStore({ dbPath: join(directory, "tensor-book.db") });
  const { app } = createApp({ store, serveStatic: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/SKILL.md`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/markdown/);
    const skill = await response.text();
    assert.match(skill, /^---\nname: tensor-book\n/);
    assert.match(skill, /tensor_book_hosted/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
