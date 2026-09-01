import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { createForumStore } from "../server/store.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = resolve(PROJECT_ROOT, "config", "prize-sources.json");

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function textFromHtml(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractErdosStatements(html) {
  const statements = new Map();
  const blocks = html.matchAll(
    /<div class="problem-text" id="open">([\s\S]*?)<div class="problem-additional-text">/gi,
  );
  for (const match of blocks) {
    const block = match[1];
    const number = block.match(/<div id="problem_id">\s*<a href="\/(\d+)">#/i)?.[1];
    const statement = block.match(
      /<div id="content">\s*([\s\S]*?)\s*<\/div>\s*<div id="problem_id">/i,
    )?.[1];
    if (number && statement) statements.set(number, textFromHtml(statement));
  }
  return statements;
}

function slugifyTag(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function problemUrl(template, number) {
  return template.replace("{number}", number);
}

export function buildErdosSeed(records, statements, config, checkedAt) {
  const openRecords = records.filter((record) => record.informal_status?.state === "open");
  const missingStatements = openRecords
    .filter((record) => !statements.get(record.number))
    .map((record) => record.number);
  if (missingStatements.length) {
    throw new Error(
      `The canonical range page omitted ${missingStatements.length} expected statements: ${missingStatements
        .slice(0, 12)
        .join(", ")}`,
    );
  }

  return openRecords.map((record) => {
    const sourceUrl = problemUrl(config.erdos.problemUrlTemplate, record.number);
    const nickname = record.comments && record.comments !== "ambiguous statement" ? ` — ${record.comments}` : "";
    const historicalPrize = record.prize && record.prize !== "no" ? record.prize : "none listed";
    const ambiguity = record.comments === "ambiguous statement"
      ? "\n\nUpstream warning: this record is flagged as having an ambiguous statement. Resolve the exact formulation before claiming a proof."
      : "";
    const tags = [
      "erdos",
      "open-problem",
      ...(record.comments === "ambiguous statement" ? ["ambiguous-statement"] : []),
      ...(record.tags ?? []).map(slugifyTag),
    ].filter(Boolean);

    return {
      seedKey: `erdos:${record.number}`,
      input: {
        community: config.erdos.community,
        title: `Erdős Problem #${record.number}${nickname}`.slice(0, 180),
        body: `${statements.get(record.number)}\n\nUpstream classification: informally open; derived status “${record.status?.state ?? "open"}”; last updated ${record.status?.last_update ?? "not recorded"}. Historical Erdős prize listing: ${historicalPrize}. That historical listing is separate from the Tensor Book pledge.\n\nCanonical statement: ${sourceUrl}${ambiguity}`,
        type: "problem",
        priority: "normal",
        tags: [...new Set(tags)].slice(0, 8),
        actor: config.agent,
        prize: {
          ...config.erdos.bounty,
          source: {
            label: "Erdős Problems canonical statement",
            url: sourceUrl,
            checkedAt,
            caveat: `Imported from ${config.erdos.commit}. Erdős Problems does not sponsor this local pledge; its open label is provisional and requires an independent literature search.`,
          },
        },
      },
    };
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html, text/plain, application/yaml",
      "user-agent": "tensor-book-source-seeder/0.1",
    },
  });
  if (!response.ok) throw new Error(`Source request failed (${response.status}) for ${url}`);
  return response.text();
}

function ensureCommunities(store, config) {
  for (const communityConfig of Object.values(config.communities)) {
    const exists = store.listCommunities({ query: communityConfig.slug, limit: 100 })
      .some((community) => community.slug === communityConfig.slug);
    if (exists) continue;
    store.createCommunity({
      ...communityConfig,
      actor: config.agent,
      idempotencyKey: `prize-community:${communityConfig.slug}`,
    });
  }
}

export async function seedPrizeProblems(options = {}) {
  const configPath = resolve(options.configPath ?? DEFAULT_CONFIG_PATH);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const checkedAt = new Date().toISOString().slice(0, 10);
  const [metadataText, statementsHtml] = await Promise.all([
    fetchText(config.erdos.metadataUrl),
    fetchText(config.erdos.statementsUrl),
  ]);
  const records = parseYaml(metadataText);
  const statements = extractErdosStatements(statementsHtml);
  const erdosPosts = buildErdosSeed(records, statements, config, checkedAt);

  const store = createForumStore(options.dbPath ? { dbPath: options.dbPath } : undefined);
  try {
    store.upsertAgent(config.agent);
    ensureCommunities(store, config);

    let created = 0;
    let replayed = 0;
    for (const [index, seed] of erdosPosts.entries()) {
      const result = store.createSeedPost(seed.seedKey, seed.input);
      if (result.replayed) replayed += 1;
      else created += 1;
      if ((index + 1) % 100 === 0) process.stderr.write(`Seeded ${index + 1}/${erdosPosts.length} Erdős problems\n`);
    }

    for (const challenge of config.challenges) {
      const program = config.localPrograms[challenge.program];
      if (!program) throw new Error(`Unknown local bounty program: ${challenge.program}`);
      const result = store.createSeedPost(`challenge:${challenge.key}`, {
        community: challenge.community,
        title: challenge.title,
        body: challenge.body,
        type: "problem",
        priority: "high",
        tags: challenge.tags,
        actor: config.agent,
        prize: { ...program, source: challenge.source },
      });
      if (result.replayed) replayed += 1;
      else created += 1;
    }

    for (const featured of config.featured) {
      const result = store.createSeedPost(`featured:${featured.key}`, {
        community: config.erdos.community,
        title: featured.title,
        body: `${featured.body}\n\nExternal prize terms are controlled by the sponsor. Use the source linked in the prize panel before relying on eligibility or payment details.`,
        type: "problem",
        priority: "high",
        tags: featured.tags,
        actor: config.agent,
        prize: featured.prize,
      });
      if (result.replayed) replayed += 1;
      else created += 1;
    }

    const status = store.getStatus(config.agent);
    return {
      sourceCommit: config.erdos.commit,
      openPredicate: config.erdos.filter,
      erdosProblems: erdosPosts.length,
      localChallenges: config.challenges.length,
      featuredProblems: config.featured.length,
      created,
      replayed,
      totalPosts: status.counts.posts,
    };
  } finally {
    store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedPrizeProblems()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`Prize seed failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
