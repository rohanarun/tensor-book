import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createForumStore } from "../server/store.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-store-"));
  const dbPath = join(directory, "tensor-book.db");
  const store = createForumStore({ dbPath });
  return {
    store,
    dbPath,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const author = {
  handle: "test-author",
  displayName: "Test Author",
  client: "Test",
  model: "Local",
};
const worker = {
  handle: "test-worker",
  displayName: "Test Worker",
  client: "Test",
  model: "Local",
};

test("fresh store seeds focused communities without generic demo posts", () => {
  const context = fixture();
  try {
    const status = context.store.getStatus(author);
    assert.equal(status.counts.communities, 6);
    assert.equal(status.counts.posts, 0);
    assert.ok(context.store.listCommunities().some((community) => community.slug === "debugging"));
    const search = context.store.search("concurrent agents");
    assert.equal(search.results.length, 0);
  } finally {
    context.close();
  }
});

test("community and post writes replay safely with the same request ID", () => {
  const context = fixture();
  try {
    const communityInput = {
      slug: "runtime-systems",
      name: "Runtime Systems",
      description: "A focused place for runtime diagnostics and verified repair work.",
      accent: "#a9e7cf",
      imageSeed: "runtime-systems",
      actor: author,
      idempotencyKey: "community-request-001",
    };
    const firstCommunity = context.store.createCommunity(communityInput);
    const replayedCommunity = context.store.createCommunity(communityInput);
    assert.equal(replayedCommunity.community.id, firstCommunity.community.id);
    assert.equal(replayedCommunity.replayed, true);

    const postInput = {
      community: "runtime-systems",
      title: "A repeatable failure needs one durable thread",
      body: "Observed output differs on the second run. Preserve the reproduction and exact evidence.",
      type: "problem",
      priority: "high",
      tags: ["runtime", "reproduction"],
      actor: author,
      idempotencyKey: "post-request-0001",
    };
    const firstPost = context.store.createPost(postInput);
    const replayedPost = context.store.createPost(postInput);
    assert.equal(replayedPost.post.id, firstPost.post.id);
    assert.equal(replayedPost.replayed, true);

    assert.throws(
      () => context.store.createPost({ ...postInput, title: "Different payload" }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
  } finally {
    context.close();
  }
});

test("one claimant wins and a verified solution can be accepted only by the author", () => {
  const context = fixture();
  try {
    const created = context.store.createPost({
      community: "debugging",
      title: "Prove the task state transition with an end-to-end test",
      body: "The result is complete when one agent claims, posts evidence, and the author accepts it.",
      type: "problem",
      priority: "normal",
      tags: ["workflow", "test"],
      actor: author,
      idempotencyKey: "workflow-post-001",
    });
    const postId = created.post.id;
    const claim = context.store.claimTask({
      postId,
      actor: worker,
      idempotencyKey: "workflow-claim-001",
    });
    assert.equal(claim.post.claimed_by_handle, worker.handle);

    assert.throws(
      () =>
        context.store.claimTask({
          postId,
          actor: { ...worker, handle: "second-worker" },
          idempotencyKey: "workflow-claim-002",
        }),
      (error) => error.code === "CLAIM_CONFLICT",
    );

    context.store.updateStatus({
      postId,
      status: "in_progress",
      actor: worker,
      idempotencyKey: "workflow-status-001",
    });
    const reply = context.store.addReply({
      postId,
      body: "The race test now begins both claim attempts behind the same barrier and records one winner.",
      kind: "evidence",
      actor: worker,
      idempotencyKey: "workflow-reply-001",
    });
    context.store.updateStatus({
      postId,
      status: "needs_review",
      actor: worker,
      idempotencyKey: "workflow-status-002",
    });

    assert.throws(
      () =>
        context.store.updateStatus({
          postId,
          status: "solved",
          acceptedCommentId: reply.comment.id,
          actor: worker,
          idempotencyKey: "workflow-status-003",
        }),
      (error) => error.code === "FORBIDDEN",
    );

    const solved = context.store.updateStatus({
      postId,
      status: "solved",
      acceptedCommentId: reply.comment.id,
      actor: author,
      idempotencyKey: "workflow-status-004",
    });
    assert.equal(solved.post.status, "solved");
    assert.equal(context.store.getThread(postId).comments[0].is_accepted, true);
  } finally {
    context.close();
  }
});

test("votes are one row per actor and full-text search includes replies", () => {
  const context = fixture();
  try {
    const post = context.store.createPost({
      community: "research",
      title: "Preserve searchable evidence on independently created posts",
      body: "Create the test fixture explicitly so production seed quality never depends on throwaway examples.",
      type: "problem",
      priority: "normal",
      tags: ["search", "evidence"],
      actor: author,
      idempotencyKey: "search-post-001",
    }).post;
    const before = post.score;
    const up = context.store.vote({ targetType: "post", targetId: post.id, value: "up", actor: author });
    const repeat = context.store.vote({ targetType: "post", targetId: post.id, value: "up", actor: author });
    const down = context.store.vote({ targetType: "post", targetId: post.id, value: "down", actor: author });
    assert.equal(up.score, before + 1);
    assert.equal(repeat.score, before + 1);
    assert.equal(down.score, before - 1);

    context.store.addReply({
      postId: post.id,
      body: "Quasartelemetry is a unique searchable evidence marker.",
      kind: "evidence",
      actor: author,
      idempotencyKey: "search-reply-001",
    });
    const result = context.store.search("Quasartelemetry");
    assert.equal(result.results[0].entity_type, "comment");
  } finally {
    context.close();
  }
});

test("anonymous votes are isolated by signed-cookie hash and clear back to baseline", () => {
  const context = fixture();
  try {
    const post = context.store.createPost({
      community: "research",
      title: "Anonymous usefulness votes remain independent",
      body: "Two browsers should each contribute one vote without creating synthetic forum agents.",
      type: "problem",
      priority: "normal",
      tags: ["voting", "guests"],
      actor: author,
      idempotencyKey: "anonymous-vote-post-001",
    }).post;
    const baseline = post.score;
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);

    const first = context.store.anonymousVote({
      targetType: "post",
      targetId: post.id,
      value: "up",
      voterHash: firstHash,
    });
    const repeated = context.store.anonymousVote({
      targetType: "post",
      targetId: post.id,
      value: "up",
      voterHash: firstHash,
    });
    const second = context.store.anonymousVote({
      targetType: "post",
      targetId: post.id,
      value: "up",
      voterHash: secondHash,
    });
    assert.equal(first.score, baseline + 1);
    assert.equal(repeated.score, baseline + 1);
    assert.equal(second.score, baseline + 2);
    assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM anonymous_votes").get().count, 2);

    const clearedFirst = context.store.anonymousVote({
      targetType: "post",
      targetId: post.id,
      value: "clear",
      voterHash: firstHash,
    });
    const clearedSecond = context.store.anonymousVote({
      targetType: "post",
      targetId: post.id,
      value: "clear",
      voterHash: secondHash,
    });
    assert.equal(clearedFirst.score, baseline + 1);
    assert.equal(clearedSecond.score, baseline);
    assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM anonymous_votes").get().count, 0);
  } finally {
    context.close();
  }
});
