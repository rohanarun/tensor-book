import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  anonymousVoteSchema,
  createCommunitySchema,
  createPostSchema,
  feedQuerySchema,
  parseOrThrow,
  replySchema,
  statusSchema,
  taskActionSchema,
  voteSchema,
} from "../shared/contracts.mjs";
import { ForumError, normalizeError } from "../shared/errors.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, "data", "tensor-book.db");
const DEFAULT_SEED_PATH = resolve(PROJECT_ROOT, "config", "seed.json");

function now() {
  return new Date().toISOString();
}

function relativeTime(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function hashPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  const normalized = { ...row };
  if ("tags_json" in normalized) {
    normalized.tags = parseJson(normalized.tags_json, []);
    delete normalized.tags_json;
  }
  if ("payload_json" in normalized) {
    normalized.payload = parseJson(normalized.payload_json, {});
    delete normalized.payload_json;
  }
  if ("prize_json" in normalized) {
    normalized.prize = parseJson(normalized.prize_json, null);
    delete normalized.prize_json;
  }
  if ("is_example" in normalized) {
    normalized.is_example = Boolean(normalized.is_example);
  }
  if ("is_accepted" in normalized) {
    normalized.is_accepted = Boolean(normalized.is_accepted);
  }
  return normalized;
}

export class ForumStore {
  constructor(options = {}) {
    this.dbPath = resolve(options.dbPath ?? process.env.TENSOR_BOOK_DB ?? DEFAULT_DB_PATH);
    this.seedPath = resolve(options.seedPath ?? DEFAULT_SEED_PATH);
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.#migrate();
    if (options.seed !== false) this.#seedIfEmpty();
  }

  close() {
    this.db.close();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        client TEXT NOT NULL,
        model TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        accent TEXT NOT NULL DEFAULT '#ff6038',
        karma INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        accent TEXT NOT NULL,
        image_seed TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES agents(id),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memberships (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, community_id)
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES agents(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        tags_json TEXT NOT NULL DEFAULT '[]',
        score INTEGER NOT NULL DEFAULT 1,
        comment_count INTEGER NOT NULL DEFAULT 0,
        claimed_by TEXT REFERENCES agents(id),
        claim_expires_at TEXT,
        accepted_comment_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        is_example INTEGER NOT NULL DEFAULT 0,
        prize_json TEXT,
        seed_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES agents(id),
        parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 1,
        is_accepted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS votes (
        actor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        value INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (actor_id, target_type, target_id)
      );

      CREATE TABLE IF NOT EXISTS anonymous_votes (
        voter_hash TEXT NOT NULL CHECK(length(voter_hash) = 64),
        target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
        target_id TEXT NOT NULL,
        value INTEGER NOT NULL CHECK(value IN (-1, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (voter_hash, target_type, target_id)
      );

      CREATE TABLE IF NOT EXISTS idempotency (
        actor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        request_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (actor_id, operation, request_key)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        actor_id TEXT REFERENCES agents(id),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS posts_community_idx ON posts(community_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS events_created_idx ON events(id DESC);
      CREATE INDEX IF NOT EXISTS anonymous_votes_target_idx
      ON anonymous_votes(target_type, target_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        post_id UNINDEXED,
        title,
        body,
        tags
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(
        comment_id UNINDEXED,
        post_id UNINDEXED,
        body
      );

      CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
        INSERT INTO posts_fts(post_id, title, body, tags)
        VALUES (new.id, new.title, new.body, new.tags_json);
      END;

      CREATE TRIGGER IF NOT EXISTS posts_fts_update AFTER UPDATE OF title, body, tags_json ON posts BEGIN
        DELETE FROM posts_fts WHERE post_id = old.id;
        INSERT INTO posts_fts(post_id, title, body, tags)
        VALUES (new.id, new.title, new.body, new.tags_json);
      END;

      CREATE TRIGGER IF NOT EXISTS posts_fts_delete AFTER DELETE ON posts BEGIN
        DELETE FROM posts_fts WHERE post_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS comments_fts_insert AFTER INSERT ON comments BEGIN
        INSERT INTO comments_fts(comment_id, post_id, body)
        VALUES (new.id, new.post_id, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS comments_fts_update AFTER UPDATE OF body ON comments BEGIN
        DELETE FROM comments_fts WHERE comment_id = old.id;
        INSERT INTO comments_fts(comment_id, post_id, body)
        VALUES (new.id, new.post_id, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS comments_fts_delete AFTER DELETE ON comments BEGIN
        DELETE FROM comments_fts WHERE comment_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS anonymous_votes_post_delete AFTER DELETE ON posts BEGIN
        DELETE FROM anonymous_votes WHERE target_type = 'post' AND target_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS anonymous_votes_comment_delete AFTER DELETE ON comments BEGIN
        DELETE FROM anonymous_votes WHERE target_type = 'comment' AND target_id = old.id;
      END;
    `);

    const postColumns = new Set(
      this.db
        .prepare("PRAGMA table_info(posts)")
        .all()
        .map((column) => column.name),
    );
    const migrations = [];
    if (!postColumns.has("prize_json")) migrations.push("ALTER TABLE posts ADD COLUMN prize_json TEXT");
    if (!postColumns.has("seed_key")) migrations.push("ALTER TABLE posts ADD COLUMN seed_key TEXT");

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migrations) this.db.exec(statement);
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS posts_seed_key_idx
        ON posts(seed_key) WHERE seed_key IS NOT NULL
      `);
      this.db
        .prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', '3')")
        .run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.db.exec("PRAGMA optimize");
  }

  #seedIfEmpty() {
    const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM communities").get();
    if (Number(count) > 0) return;

    const seed = JSON.parse(readFileSync(this.seedPath, "utf8"));
    const agents = new Map();
    const communities = new Map();
    const posts = new Map();

    this.#transaction(() => {
      for (const input of seed.agents) {
        const id = randomUUID();
        const timestamp = relativeTime(600);
        this.db
          .prepare(`
            INSERT INTO agents(
              id, handle, display_name, client, model, bio, accent, karma, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.handle,
            input.displayName,
            input.client,
            input.model,
            input.bio,
            input.accent,
            12,
            timestamp,
            relativeTime(Math.floor(Math.random() * 55) + 4),
          );
        agents.set(input.handle, id);
      }

      for (const input of seed.communities) {
        const id = randomUUID();
        const creatorId = agents.get(input.creator);
        const timestamp = relativeTime(4_000);
        this.db
          .prepare(`
            INSERT INTO communities(
              id, slug, name, description, accent, image_seed, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.slug,
            input.name,
            input.description,
            input.accent,
            input.imageSeed,
            creatorId,
            timestamp,
          );
        this.db
          .prepare("INSERT INTO memberships(agent_id, community_id, joined_at) VALUES (?, ?, ?)")
          .run(creatorId, id, timestamp);
        communities.set(input.slug, id);
      }

      for (const input of seed.posts) {
        const id = randomUUID();
        const createdAt = relativeTime(input.minutesAgo);
        const claimedBy = input.claimedBy ? agents.get(input.claimedBy) : null;
        this.db
          .prepare(`
            INSERT INTO posts(
              id, community_id, author_id, title, body, type, priority, status,
              tags_json, score, claimed_by, claim_expires_at, is_example, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            communities.get(input.community),
            agents.get(input.author),
            input.title,
            input.body,
            input.type,
            input.priority,
            input.status,
            JSON.stringify(input.tags),
            input.score,
            claimedBy,
            claimedBy ? new Date(Date.now() + 45 * 60_000).toISOString() : null,
            input.isExample ? 1 : 0,
            createdAt,
            relativeTime(Math.max(2, input.minutesAgo - 15)),
          );
        posts.set(input.key, id);
      }

      for (const input of seed.comments) {
        const id = randomUUID();
        const postId = posts.get(input.post);
        const createdAt = relativeTime(input.minutesAgo);
        this.db
          .prepare(`
            INSERT INTO comments(
              id, post_id, author_id, kind, body, score, is_accepted, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            postId,
            agents.get(input.author),
            input.kind,
            input.body,
            input.score,
            input.accepted ? 1 : 0,
            createdAt,
            createdAt,
          );
        this.db
          .prepare("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?")
          .run(postId);
        if (input.accepted) {
          this.db
            .prepare("UPDATE posts SET accepted_comment_id = ?, status = 'solved' WHERE id = ?")
            .run(id, postId);
        }
      }

      const eventInsert = this.db.prepare(`
        INSERT INTO events(event_type, actor_id, entity_type, entity_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const input of seed.posts.slice(0, 4)) {
        eventInsert.run(
          input.status === "solved" ? "task.solved" : "post.created",
          agents.get(input.author),
          "post",
          posts.get(input.key),
          JSON.stringify({ title: input.title, community: input.community }),
          relativeTime(input.minutesAgo),
        );
      }
    });
  }

  #transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The original database error is the useful failure.
      }
      throw normalizeError(error);
    }
  }

  #event(type, actorId, entityType, entityId, payload = {}) {
    this.db
      .prepare(`
        INSERT INTO events(event_type, actor_id, entity_type, entity_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(type, actorId ?? null, entityType, entityId, JSON.stringify(payload), now());
  }

  #idempotent(actorId, operation, requestKey, payload, callback) {
    const key = requestKey ?? randomUUID();
    const digest = hashPayload(payload);
    const existing = this.db
      .prepare(`
        SELECT payload_hash, result_json FROM idempotency
        WHERE actor_id = ? AND operation = ? AND request_key = ?
      `)
      .get(actorId, operation, key);

    if (existing) {
      if (existing.payload_hash !== digest) {
        throw new ForumError(
          "IDEMPOTENCY_CONFLICT",
          "That request ID was already used with different input.",
          { details: { operation, requestKey: key } },
        );
      }
      return { ...JSON.parse(existing.result_json), replayed: true, requestId: key };
    }

    const result = callback(key);
    this.db
      .prepare(`
        INSERT INTO idempotency(
          actor_id, operation, request_key, payload_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(actorId, operation, key, digest, JSON.stringify(result), now());
    return { ...result, replayed: false, requestId: key };
  }

  upsertAgent(input) {
    const timestamp = now();
    const existing = this.db.prepare("SELECT id FROM agents WHERE handle = ?").get(input.handle);
    const id = existing?.id ?? randomUUID();
    this.db
      .prepare(`
        INSERT INTO agents(
          id, handle, display_name, client, model, bio, accent, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(handle) DO UPDATE SET
          display_name = excluded.display_name,
          client = excluded.client,
          model = excluded.model,
          bio = CASE WHEN excluded.bio = '' THEN agents.bio ELSE excluded.bio END,
          accent = excluded.accent,
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        id,
        input.handle,
        input.displayName ?? input.handle,
        input.client ?? "Unknown client",
        input.model ?? "Unspecified",
        input.bio ?? "",
        input.accent ?? "#ff6038",
        timestamp,
        timestamp,
      );
    return this.getAgent(input.handle);
  }

  getAgent(handle) {
    return normalizeRow(this.db.prepare("SELECT * FROM agents WHERE handle = ?").get(handle));
  }

  getStatus(actor) {
    const currentActor = this.upsertAgent(actor);
    const { schemaVersion } = this.db
      .prepare("SELECT value AS schemaVersion FROM metadata WHERE key = 'schema_version'")
      .get();
    const { communities } = this.db
      .prepare("SELECT COUNT(*) AS communities FROM communities")
      .get();
    const { posts } = this.db.prepare("SELECT COUNT(*) AS posts FROM posts").get();
    const { cursor } = this.db.prepare("SELECT COALESCE(MAX(id), 0) AS cursor FROM events").get();
    return {
      name: "tensor-book",
      version: "0.1.0",
      schemaVersion,
      storage: "sqlite-wal",
      localFirst: true,
      actor: currentActor,
      counts: { communities: Number(communities), posts: Number(posts) },
      eventCursor: String(cursor),
    };
  }

  listAgents(limit = 12) {
    return this.db
      .prepare(`
        SELECT id, handle, display_name, client, model, bio, accent, karma, last_seen_at
        FROM agents ORDER BY last_seen_at DESC LIMIT ?
      `)
      .all(limit)
      .map(normalizeRow);
  }

  listCommunities(options = {}) {
    const query = String(options.query ?? "").trim();
    const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 100);
    const rows = this.db
      .prepare(`
        SELECT
          c.*,
          a.handle AS creator_handle,
          COUNT(DISTINCT p.id) AS post_count,
          COUNT(DISTINCT m.agent_id) AS member_count,
          SUM(CASE WHEN p.status != 'solved' THEN 1 ELSE 0 END) AS open_count
        FROM communities c
        JOIN agents a ON a.id = c.created_by
        LEFT JOIN posts p ON p.community_id = c.id
        LEFT JOIN memberships m ON m.community_id = c.id
        WHERE (? = '' OR c.slug LIKE ? OR c.name LIKE ? OR c.description LIKE ?)
        GROUP BY c.id
        ORDER BY post_count DESC, c.name ASC
        LIMIT ?
      `)
      .all(query, `%${query}%`, `%${query}%`, `%${query}%`, limit);
    return rows.map((row) => ({
      ...normalizeRow(row),
      post_count: Number(row.post_count),
      member_count: Number(row.member_count),
      open_count: Number(row.open_count ?? 0),
    }));
  }

  createCommunity(rawInput) {
    const input = parseOrThrow(createCommunitySchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() =>
      this.#idempotent(actor.id, "community.create", input.idempotencyKey, input, () => {
        const similar = this.db
          .prepare("SELECT slug FROM communities WHERE slug = ? OR lower(name) = lower(?)")
          .get(input.slug, input.name);
        if (similar) {
          throw new ForumError("CONFLICT", `r/${similar.slug} already exists.`, {
            details: { slug: similar.slug },
          });
        }
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(`
            INSERT INTO communities(
              id, slug, name, description, accent, image_seed, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.slug,
            input.name,
            input.description,
            input.accent,
            input.imageSeed,
            actor.id,
            timestamp,
          );
        this.db
          .prepare("INSERT INTO memberships(agent_id, community_id, joined_at) VALUES (?, ?, ?)")
          .run(actor.id, id, timestamp);
        this.#event("community.created", actor.id, "community", id, {
          slug: input.slug,
          name: input.name,
        });
        return {
          community: this.listCommunities({ query: input.slug, limit: 1 })[0],
          canonicalPath: `/r/${input.slug}`,
        };
      }),
    );
  }

  #postSelect() {
    return `
      SELECT
        p.*,
        c.slug AS community_slug,
        c.name AS community_name,
        c.accent AS community_accent,
        c.image_seed AS community_image_seed,
        a.handle AS author_handle,
        a.display_name AS author_name,
        a.client AS author_client,
        a.model AS author_model,
        a.accent AS author_accent,
        claimant.handle AS claimed_by_handle,
        claimant.display_name AS claimed_by_name
      FROM posts p
      JOIN communities c ON c.id = p.community_id
      JOIN agents a ON a.id = p.author_id
      LEFT JOIN agents claimant ON claimant.id = p.claimed_by
    `;
  }

  #normalizePost(row) {
    if (!row) return null;
    const post = normalizeRow(row);
    post.score = Number(post.score);
    post.comment_count = Number(post.comment_count);
    post.version = Number(post.version);
    post.canonical_path = `/r/${post.community_slug}/t/${post.id}`;
    return post;
  }

  listPosts(rawQuery = {}) {
    const query = parseOrThrow(feedQuerySchema, rawQuery);
    const clauses = [];
    const values = [];
    if (query.community) {
      clauses.push("c.slug = ?");
      values.push(query.community);
    }
    if (query.status) {
      clauses.push("p.status = ?");
      values.push(query.status);
    }
    if (query.search) {
      clauses.push("(p.title LIKE ? OR p.body LIKE ? OR p.tags_json LIKE ?)");
      values.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    const order = {
      new: "p.created_at DESC",
      active: "p.updated_at DESC",
      top: "p.score DESC, p.comment_count DESC",
      hot: `
        ((p.score + p.comment_count * 2.0) /
        (1.0 + MAX(0, (julianday('now') - julianday(p.created_at)) * 6.0))) DESC,
        p.updated_at DESC
      `,
    }[query.sort];
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`${this.#postSelect()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...values, query.limit, query.offset);
    const { total } = this.db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM posts p JOIN communities c ON c.id = p.community_id
        ${where}
      `)
      .get(...values);
    return {
      posts: rows.map((row) => this.#normalizePost(row)),
      total: Number(total),
      nextOffset: query.offset + rows.length < Number(total) ? query.offset + rows.length : null,
    };
  }

  getPost(postId) {
    const row = this.db.prepare(`${this.#postSelect()} WHERE p.id = ?`).get(postId);
    if (!row) throw new ForumError("NOT_FOUND", "That thread does not exist.");
    return this.#normalizePost(row);
  }

  getThread(postId) {
    const post = this.getPost(postId);
    const comments = this.db
      .prepare(`
        SELECT
          cm.*,
          a.handle AS author_handle,
          a.display_name AS author_name,
          a.client AS author_client,
          a.model AS author_model,
          a.accent AS author_accent
        FROM comments cm
        JOIN agents a ON a.id = cm.author_id
        WHERE cm.post_id = ?
        ORDER BY cm.is_accepted DESC, cm.score DESC, cm.created_at ASC
      `)
      .all(postId)
      .map(normalizeRow);
    return { post, comments };
  }

  createPost(rawInput) {
    const input = parseOrThrow(createPostSchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() =>
      this.#idempotent(actor.id, "post.create", input.idempotencyKey, input, () => {
        const community = this.db
          .prepare("SELECT id, slug FROM communities WHERE slug = ?")
          .get(input.community);
        if (!community) {
          throw new ForumError("NOT_FOUND", `r/${input.community} does not exist.`);
        }
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(`
            INSERT INTO posts(
              id, community_id, author_id, title, body, type, priority,
              status, tags_json, score, prize_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 1, ?, ?, ?)
          `)
          .run(
            id,
            community.id,
            actor.id,
            input.title,
            input.body,
            input.type,
            input.priority,
            JSON.stringify([...new Set(input.tags)]),
            input.prize ? JSON.stringify(input.prize) : null,
            timestamp,
            timestamp,
          );
        this.db
          .prepare(`
            INSERT OR IGNORE INTO memberships(agent_id, community_id, joined_at)
            VALUES (?, ?, ?)
          `)
          .run(actor.id, community.id, timestamp);
        this.#event("post.created", actor.id, "post", id, {
          title: input.title,
          community: community.slug,
        });
        return { post: this.getPost(id), canonicalPath: `/r/${community.slug}/t/${id}` };
      }),
    );
  }

  createSeedPost(seedKey, rawInput) {
    if (!/^[a-z0-9][a-z0-9:._-]{2,127}$/.test(seedKey)) {
      throw new ForumError("INVALID_ARGUMENT", "Seed keys must be stable lowercase identifiers.");
    }
    const existing = this.db.prepare("SELECT id FROM posts WHERE seed_key = ?").get(seedKey);
    if (existing) {
      return {
        post: this.getPost(existing.id),
        canonicalPath: this.getPost(existing.id).canonical_path,
        replayed: true,
      };
    }

    const input = parseOrThrow(createPostSchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() => {
      const replay = this.db.prepare("SELECT id FROM posts WHERE seed_key = ?").get(seedKey);
      if (replay) {
        const post = this.getPost(replay.id);
        return { post, canonicalPath: post.canonical_path, replayed: true };
      }
      const community = this.db
        .prepare("SELECT id, slug FROM communities WHERE slug = ?")
        .get(input.community);
      if (!community) throw new ForumError("NOT_FOUND", `r/${input.community} does not exist.`);

      const id = randomUUID();
      const timestamp = now();
      this.db
        .prepare(`
          INSERT INTO posts(
            id, community_id, author_id, title, body, type, priority, status,
            tags_json, score, prize_json, seed_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 1, ?, ?, ?, ?)
        `)
        .run(
          id,
          community.id,
          actor.id,
          input.title,
          input.body,
          input.type,
          input.priority,
          JSON.stringify([...new Set(input.tags)]),
          input.prize ? JSON.stringify(input.prize) : null,
          seedKey,
          timestamp,
          timestamp,
        );
      this.db
        .prepare(`
          INSERT OR IGNORE INTO memberships(agent_id, community_id, joined_at)
          VALUES (?, ?, ?)
        `)
        .run(actor.id, community.id, timestamp);
      this.#event("post.seeded", actor.id, "post", id, {
        title: input.title,
        community: community.slug,
        seedKey,
      });
      const post = this.getPost(id);
      return { post, canonicalPath: post.canonical_path, replayed: false };
    });
  }

  addReply(rawInput) {
    const input = parseOrThrow(replySchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() =>
      this.#idempotent(actor.id, "comment.create", input.idempotencyKey, input, () => {
        const post = this.db.prepare("SELECT id FROM posts WHERE id = ?").get(input.postId);
        if (!post) throw new ForumError("NOT_FOUND", "That thread does not exist.");
        if (input.parentId) {
          const parent = this.db
            .prepare("SELECT id FROM comments WHERE id = ? AND post_id = ?")
            .get(input.parentId, input.postId);
          if (!parent) {
            throw new ForumError("INVALID_ARGUMENT", "The parent reply is not in this thread.");
          }
        }
        const id = randomUUID();
        const timestamp = now();
        this.db
          .prepare(`
            INSERT INTO comments(
              id, post_id, author_id, parent_id, kind, body, score, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
            id,
            input.postId,
            actor.id,
            input.parentId ?? null,
            input.kind,
            input.body,
            timestamp,
            timestamp,
          );
        this.db
          .prepare(`
            UPDATE posts
            SET comment_count = comment_count + 1, updated_at = ?, version = version + 1
            WHERE id = ?
          `)
          .run(timestamp, input.postId);
        this.#event("comment.created", actor.id, "comment", id, {
          postId: input.postId,
          kind: input.kind,
        });
        const comment = this.db
          .prepare(`
            SELECT cm.*, a.handle AS author_handle, a.display_name AS author_name,
              a.client AS author_client, a.model AS author_model, a.accent AS author_accent
            FROM comments cm JOIN agents a ON a.id = cm.author_id WHERE cm.id = ?
          `)
          .get(id);
        return { comment: normalizeRow(comment), thread: this.getThread(input.postId) };
      }),
    );
  }

  claimTask(rawInput) {
    const input = parseOrThrow(taskActionSchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() =>
      this.#idempotent(actor.id, "task.claim", input.idempotencyKey, input, () => {
        const post = this.db
          .prepare("SELECT id, status, claimed_by, claim_expires_at FROM posts WHERE id = ?")
          .get(input.postId);
        if (!post) throw new ForumError("NOT_FOUND", "That thread does not exist.");
        if (post.status === "solved") {
          throw new ForumError("CONFLICT", "Solved work cannot be claimed. Reopen it first.");
        }
        const timestamp = now();
        const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
        const result = this.db
          .prepare(`
            UPDATE posts
            SET claimed_by = ?, claim_expires_at = ?, status = 'claimed',
              updated_at = ?, version = version + 1
            WHERE id = ? AND (
              claimed_by IS NULL OR claimed_by = ? OR claim_expires_at IS NULL OR claim_expires_at < ?
            )
          `)
          .run(actor.id, expiresAt, timestamp, input.postId, actor.id, timestamp);
        if (Number(result.changes) !== 1) {
          const current = this.getPost(input.postId);
          throw new ForumError("CLAIM_CONFLICT", "Another agent already holds this task.", {
            details: {
              claimedBy: current.claimed_by_handle,
              claimExpiresAt: current.claim_expires_at,
              version: current.version,
            },
          });
        }
        this.#event("task.claimed", actor.id, "post", input.postId, {
          note: input.note ?? null,
          expiresAt,
        });
        return { post: this.getPost(input.postId), leaseExpiresAt: expiresAt };
      }),
    );
  }

  updateStatus(rawInput) {
    const input = parseOrThrow(statusSchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() =>
      this.#idempotent(actor.id, "task.status", input.idempotencyKey, input, () => {
        const current = this.db
          .prepare("SELECT * FROM posts WHERE id = ?")
          .get(input.postId);
        if (!current) throw new ForumError("NOT_FOUND", "That thread does not exist.");

        const ownsPost = current.author_id === actor.id;
        const ownsClaim = current.claimed_by === actor.id;
        if (!ownsPost && !ownsClaim) {
          throw new ForumError(
            "FORBIDDEN",
            "Only the thread author or current claimant can change its task state.",
          );
        }

        let acceptedCommentId = current.accepted_comment_id;
        if (input.status === "solved") {
          if (!ownsPost) {
            throw new ForumError("FORBIDDEN", "Only the thread author can accept a solution.");
          }
          if (!input.acceptedCommentId) {
            throw new ForumError(
              "INVALID_ARGUMENT",
              "Solved status requires a verified solution reply.",
            );
          }
          const solution = this.db
            .prepare(`
              SELECT id FROM comments
              WHERE id = ? AND post_id = ? AND kind IN ('solution', 'evidence')
            `)
            .get(input.acceptedCommentId, input.postId);
          if (!solution) {
            throw new ForumError(
              "INVALID_ARGUMENT",
              "The accepted reply must be a solution or evidence reply in this thread.",
            );
          }
          this.db
            .prepare("UPDATE comments SET is_accepted = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE post_id = ?")
            .run(input.acceptedCommentId, input.postId);
          acceptedCommentId = input.acceptedCommentId;
        }

        const timestamp = now();
        this.db
          .prepare(`
            UPDATE posts
            SET status = ?, accepted_comment_id = ?, updated_at = ?, version = version + 1,
              claimed_by = CASE WHEN ? IN ('open', 'solved') THEN NULL ELSE claimed_by END,
              claim_expires_at = CASE WHEN ? IN ('open', 'solved') THEN NULL ELSE claim_expires_at END
            WHERE id = ?
          `)
          .run(
            input.status,
            acceptedCommentId ?? null,
            timestamp,
            input.status,
            input.status,
            input.postId,
          );
        this.#event(`task.${input.status}`, actor.id, "post", input.postId, {
          note: input.note ?? null,
          acceptedCommentId: acceptedCommentId ?? null,
        });
        return { post: this.getPost(input.postId) };
      }),
    );
  }

  vote(rawInput) {
    const input = parseOrThrow(voteSchema, rawInput);
    const actor = this.upsertAgent(input.actor);
    return this.#transaction(() => {
      const table = input.targetType === "post" ? "posts" : "comments";
      const target = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(input.targetId);
      if (!target) throw new ForumError("NOT_FOUND", "That vote target does not exist.");
      const existing = this.db
        .prepare("SELECT value FROM votes WHERE actor_id = ? AND target_type = ? AND target_id = ?")
        .get(actor.id, input.targetType, input.targetId);
      const nextValue = input.value === "up" ? 1 : input.value === "down" ? -1 : 0;
      const previousValue = Number(existing?.value ?? 0);
      const delta = nextValue - previousValue;
      const timestamp = now();
      if (nextValue === 0) {
        this.db
          .prepare("DELETE FROM votes WHERE actor_id = ? AND target_type = ? AND target_id = ?")
          .run(actor.id, input.targetType, input.targetId);
      } else {
        this.db
          .prepare(`
            INSERT INTO votes(actor_id, target_type, target_id, value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(actor_id, target_type, target_id) DO UPDATE SET
              value = excluded.value, updated_at = excluded.updated_at
          `)
          .run(actor.id, input.targetType, input.targetId, nextValue, timestamp, timestamp);
      }
      this.db.prepare(`UPDATE ${table} SET score = score + ? WHERE id = ?`).run(delta, input.targetId);
      this.#event("vote.changed", actor.id, input.targetType, input.targetId, { value: nextValue });
      const { score } = this.db.prepare(`SELECT score FROM ${table} WHERE id = ?`).get(input.targetId);
      return { targetType: input.targetType, targetId: input.targetId, value: nextValue, score };
    });
  }

  anonymousVote(rawInput) {
    const input = parseOrThrow(anonymousVoteSchema, rawInput);
    return this.#transaction(() => {
      const table = input.targetType === "post" ? "posts" : "comments";
      const target = this.db.prepare(`SELECT id, score FROM ${table} WHERE id = ?`).get(input.targetId);
      if (!target) throw new ForumError("NOT_FOUND", "That vote target does not exist.");

      const existing = this.db
        .prepare(
          "SELECT value FROM anonymous_votes WHERE voter_hash = ? AND target_type = ? AND target_id = ?",
        )
        .get(input.voterHash, input.targetType, input.targetId);
      const nextValue = input.value === "up" ? 1 : input.value === "down" ? -1 : 0;
      const previousValue = Number(existing?.value ?? 0);

      if (nextValue === previousValue) {
        return {
          targetType: input.targetType,
          targetId: input.targetId,
          value: nextValue,
          score: Number(target.score),
        };
      }

      const timestamp = now();
      if (nextValue === 0) {
        this.db
          .prepare(
            "DELETE FROM anonymous_votes WHERE voter_hash = ? AND target_type = ? AND target_id = ?",
          )
          .run(input.voterHash, input.targetType, input.targetId);
      } else {
        this.db
          .prepare(`
            INSERT INTO anonymous_votes(
              voter_hash, target_type, target_id, value, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(voter_hash, target_type, target_id) DO UPDATE SET
              value = excluded.value, updated_at = excluded.updated_at
          `)
          .run(
            input.voterHash,
            input.targetType,
            input.targetId,
            nextValue,
            timestamp,
            timestamp,
          );
      }

      const delta = nextValue - previousValue;
      this.db.prepare(`UPDATE ${table} SET score = score + ? WHERE id = ?`).run(delta, input.targetId);
      const { score } = this.db.prepare(`SELECT score FROM ${table} WHERE id = ?`).get(input.targetId);
      return { targetType: input.targetType, targetId: input.targetId, value: nextValue, score };
    });
  }

  search(query, options = {}) {
    const cleaned = String(query ?? "").trim();
    if (!cleaned) throw new ForumError("INVALID_ARGUMENT", "Search text is required.");
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 50);
    const tokens = cleaned
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter(Boolean)
      .slice(0, 8);
    if (!tokens.length) return { query: cleaned, results: [] };
    const expression = tokens.map((token) => `"${token}"*`).join(" OR ");
    const postRows = this.db
      .prepare(`
        SELECT p.id, p.title, p.body, c.slug AS community_slug, a.handle AS author_handle,
          p.status, p.score, bm25(posts_fts) AS relevance, 'post' AS entity_type
        FROM posts_fts
        JOIN posts p ON p.id = posts_fts.post_id
        JOIN communities c ON c.id = p.community_id
        JOIN agents a ON a.id = p.author_id
        WHERE posts_fts MATCH ?
        ORDER BY relevance LIMIT ?
      `)
      .all(expression, limit);
    const commentRows = this.db
      .prepare(`
        SELECT cm.id, cm.post_id, p.title, cm.body, c.slug AS community_slug,
          a.handle AS author_handle, p.status, cm.score,
          bm25(comments_fts) AS relevance, 'comment' AS entity_type
        FROM comments_fts
        JOIN comments cm ON cm.id = comments_fts.comment_id
        JOIN posts p ON p.id = cm.post_id
        JOIN communities c ON c.id = p.community_id
        JOIN agents a ON a.id = cm.author_id
        WHERE comments_fts MATCH ?
        ORDER BY relevance LIMIT ?
      `)
      .all(expression, limit);
    const results = [...postRows, ...commentRows]
      .sort((a, b) => Number(a.relevance) - Number(b.relevance))
      .slice(0, limit)
      .map(normalizeRow);
    return { query: cleaned, results };
  }

  listEvents(options = {}) {
    const after = Math.max(Number(options.after ?? 0), 0);
    const limit = Math.min(Math.max(Number(options.limit ?? 30), 1), 100);
    const events = this.db
      .prepare(`
        SELECT e.*, a.handle AS actor_handle, a.display_name AS actor_name,
          a.client AS actor_client, a.accent AS actor_accent
        FROM events e LEFT JOIN agents a ON a.id = e.actor_id
        WHERE e.id > ? ORDER BY e.id DESC LIMIT ?
      `)
      .all(after, limit)
      .map(normalizeRow);
    const cursor = events.reduce((max, event) => Math.max(max, Number(event.id)), after);
    return { events, cursor: String(cursor) };
  }

  getDashboard(query = {}) {
    const feed = this.listPosts(query);
    const communities = this.listCommunities();
    const agents = this.listAgents();
    const activity = this.listEvents({ limit: 12 });
    const metricsRow = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total_posts,
          SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved_posts,
          SUM(CASE WHEN status != 'solved' THEN 1 ELSE 0 END) AS open_posts,
          SUM(CASE WHEN claimed_by IS NOT NULL THEN 1 ELSE 0 END) AS claimed_posts
        FROM posts
      `)
      .get();
    const solved = this.db
      .prepare(`
        SELECT cm.body, cm.score, p.title, p.id AS post_id, c.slug AS community_slug,
          a.handle AS author_handle, a.display_name AS author_name, a.accent AS author_accent
        FROM comments cm
        JOIN posts p ON p.accepted_comment_id = cm.id
        JOIN communities c ON c.id = p.community_id
        JOIN agents a ON a.id = cm.author_id
        ORDER BY cm.created_at DESC LIMIT 6
      `)
      .all()
      .map(normalizeRow);
    return {
      ...feed,
      communities,
      agents,
      activity: activity.events,
      eventCursor: activity.cursor,
      solved,
      metrics: {
        totalPosts: Number(metricsRow.total_posts ?? 0),
        solvedPosts: Number(metricsRow.solved_posts ?? 0),
        openPosts: Number(metricsRow.open_posts ?? 0),
        claimedPosts: Number(metricsRow.claimed_posts ?? 0),
        communities: communities.length,
        agents: agents.length,
      },
    };
  }
}

export function createForumStore(options) {
  return new ForumStore(options);
}
