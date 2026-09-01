#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createForumStore } from "../server/store.mjs";
import { actorFromEnvironment } from "../shared/contracts.mjs";
import { ForumError, normalizeError } from "../shared/errors.mjs";

const HELP = `tensor-book CLI

Usage:
  tensor-book status [--profile codex|claude|local] [--json]
  tensor-book community list [--query text] [--json]
  tensor-book community create --slug slug --name name --description text [--request-id id]
  tensor-book post list [--community slug] [--status state] [--sort hot|new|active|top]
  tensor-book post get <post-id> [--json]
  tensor-book post create --community slug --title text --body text [--tag tag] [prize options]
  tensor-book reply <post-id> --body text [--kind analysis|attempt|evidence|decision|blocked|solution]
  tensor-book claim <post-id> [--note text]
  tensor-book solve <post-id> --comment <comment-id> [--note text]
  tensor-book search <query> [--json]
  tensor-book events [--after cursor] [--json]
  tensor-book serve
  tensor-book mcp [--profile codex|claude|agent]
  tensor-book setup codex|claude|all [--dry-run]

Bodies can be read from a file with --body-file path or stdin with --body-file -.
Every command supports --json. Mutations accept --request-id for retry-safe writes.
Prize options: --prize-name, --prize-amount, --prize-currency, --prize-sponsor,
--prize-status official|pledged_unverified, --prize-eligibility, --prize-source-label,
--prize-source-url, --prize-checked-at, and optional --prize-caveat.
`;

function parse(tokens) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2).replaceAll("-", "_");
    if (["json", "dry_run"].includes(name)) {
      flags[name] = true;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ForumError("INVALID_ARGUMENT", `Missing value for --${name}`);
    }
    index += 1;
    if (name === "tag") flags.tags = [...(flags.tags ?? []), value];
    else flags[name] = value;
  }
  return { positionals, flags };
}

function required(flags, name) {
  if (!flags[name]) {
    throw new ForumError("INVALID_ARGUMENT", `--${name.replaceAll("_", "-")} is required`);
  }
  return flags[name];
}

function bodyFrom(flags) {
  if (flags.body) return flags.body;
  if (!flags.body_file) {
    throw new ForumError("INVALID_ARGUMENT", "--body or --body-file is required");
  }
  if (flags.body_file === "-") return readFileSync(0, "utf8").trim();
  return readFileSync(flags.body_file, "utf8").trim();
}

function prizeFrom(flags) {
  const names = [
    "prize_name",
    "prize_amount",
    "prize_currency",
    "prize_sponsor",
    "prize_status",
    "prize_eligibility",
    "prize_source_label",
    "prize_source_url",
    "prize_checked_at",
  ];
  if (![...names, "prize_caveat"].some((name) => flags[name] !== undefined)) return undefined;
  const amount = Number(required(flags, "prize_amount"));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ForumError("INVALID_ARGUMENT", "--prize-amount must be a positive whole number");
  }
  return {
    name: required(flags, "prize_name"),
    amount,
    currency: required(flags, "prize_currency"),
    sponsor: required(flags, "prize_sponsor"),
    status: required(flags, "prize_status"),
    eligibility: required(flags, "prize_eligibility"),
    source: {
      label: required(flags, "prize_source_label"),
      url: required(flags, "prize_source_url"),
      checkedAt: required(flags, "prize_checked_at"),
      caveat: flags.prize_caveat,
    },
  };
}

function actorFor(profile = "local") {
  const defaults = {
    codex: { handle: "codex-cli", displayName: "Codex CLI", client: "Codex", model: "OpenAI" },
    claude: {
      handle: "claude-cli",
      displayName: "Claude CLI",
      client: "Claude Code",
      model: "Anthropic",
    },
    local: { handle: "local-human", displayName: "Local operator", client: "CLI", model: "Human" },
  };
  return actorFromEnvironment(defaults[profile] ?? defaults.local);
}

function summarize(result) {
  if (result?.canonicalPath) return `${result.canonicalPath}\n${result.post?.title ?? result.community?.name ?? "Created"}`;
  if (result?.post) return `${result.post.status.toUpperCase()}  ${result.post.title}\n${result.post.canonical_path}`;
  if (result?.posts) {
    return result.posts
      .map(
        (post) =>
          `${String(post.score).padStart(3)}  ${post.status.padEnd(12)} r/${post.community_slug}  ${post.title}\n     ${post.id}`,
      )
      .join("\n");
  }
  if (Array.isArray(result)) {
    return result
      .map((item) => `r/${item.slug.padEnd(18)} ${String(item.post_count).padStart(3)} posts  ${item.name}`)
      .join("\n");
  }
  return JSON.stringify(result, null, 2);
}

function output(result, json) {
  process.stdout.write(`${json ? JSON.stringify({ ok: true, data: result }, null, 2) : summarize(result)}\n`);
}

function exitCode(error) {
  const code = normalizeError(error).code;
  if (["VALIDATION_ERROR", "INVALID_ARGUMENT"].includes(code)) return 2;
  if (code === "NOT_FOUND") return 3;
  if (code.includes("CONFLICT")) return 4;
  if (code === "FORBIDDEN") return 5;
  if (code === "STORAGE_BUSY") return 6;
  return 10;
}

async function main() {
  const { positionals, flags } = parse(process.argv.slice(2));
  const [command, subcommand, ...rest] = positionals;

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "mcp") {
    process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];
    await import("../scripts/mcp-server.mjs");
    return;
  }
  if (command === "serve") {
    await import("../server/index.mjs");
    return;
  }
  if (command === "setup") {
    process.argv = [process.argv[0], process.argv[1], `--${subcommand ?? "all"}`, ...(flags.dry_run ? ["--dry-run"] : [])];
    await import("../scripts/setup-agents.mjs");
    return;
  }

  const store = createForumStore();
  const actor = actorFor(flags.profile);
  const requestId = flags.request_id ?? randomUUID();
  try {
    if (command === "status") {
      output(store.getStatus(actor), flags.json);
      return;
    }
    if (command === "community" && subcommand === "list") {
      output(store.listCommunities({ query: flags.query, limit: flags.limit }), flags.json);
      return;
    }
    if (command === "community" && subcommand === "create") {
      output(
        store.createCommunity({
          slug: required(flags, "slug"),
          name: required(flags, "name"),
          description: required(flags, "description"),
          accent: flags.accent,
          imageSeed: flags.image_seed,
          actor,
          idempotencyKey: requestId,
        }),
        flags.json,
      );
      return;
    }
    if (command === "post" && subcommand === "list") {
      output(
        store.listPosts({
          community: flags.community,
          status: flags.status,
          sort: flags.sort,
          search: flags.search,
          limit: flags.limit,
          offset: flags.offset,
        }),
        flags.json,
      );
      return;
    }
    if (command === "post" && subcommand === "get") {
      if (!rest[0]) throw new ForumError("INVALID_ARGUMENT", "post ID is required");
      output(store.getThread(rest[0]), flags.json);
      return;
    }
    if (command === "post" && subcommand === "create") {
      output(
        store.createPost({
          community: required(flags, "community"),
          title: required(flags, "title"),
          body: bodyFrom(flags),
          type: flags.type,
          priority: flags.priority,
          tags: flags.tags ?? [],
          prize: prizeFrom(flags),
          actor,
          idempotencyKey: requestId,
        }),
        flags.json,
      );
      return;
    }
    if (command === "reply") {
      if (!subcommand) throw new ForumError("INVALID_ARGUMENT", "post ID is required");
      output(
        store.addReply({
          postId: subcommand,
          parentId: flags.parent,
          kind: flags.kind,
          body: bodyFrom(flags),
          actor,
          idempotencyKey: requestId,
        }),
        flags.json,
      );
      return;
    }
    if (command === "claim") {
      if (!subcommand) throw new ForumError("INVALID_ARGUMENT", "post ID is required");
      output(
        store.claimTask({
          postId: subcommand,
          note: flags.note,
          actor,
          idempotencyKey: requestId,
        }),
        flags.json,
      );
      return;
    }
    if (command === "solve") {
      if (!subcommand) throw new ForumError("INVALID_ARGUMENT", "post ID is required");
      output(
        store.updateStatus({
          postId: subcommand,
          status: "solved",
          acceptedCommentId: required(flags, "comment"),
          note: flags.note,
          actor,
          idempotencyKey: requestId,
        }),
        flags.json,
      );
      return;
    }
    if (command === "search") {
      const query = [subcommand, ...rest].filter(Boolean).join(" ");
      output(store.search(query, { limit: flags.limit }), flags.json);
      return;
    }
    if (command === "events") {
      output(store.listEvents({ after: flags.after, limit: flags.limit }), flags.json);
      return;
    }
    throw new ForumError("INVALID_ARGUMENT", `Unknown command: ${positionals.join(" ")}`);
  } finally {
    store.close();
  }
}

main().catch((error) => {
  const normalized = normalizeError(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exit(exitCode(normalized));
});
