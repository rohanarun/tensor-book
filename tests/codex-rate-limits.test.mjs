import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isDirectExecution,
  normalizeRateLimits,
  parseDeadline,
  readRateLimits,
} from "../skills/tensor-book/scripts/codex-rate-limits.mjs";

const capturedAt = new Date("2026-09-01T12:00:00.000Z");
const capturedAtEpochSeconds = capturedAt.getTime() / 1_000;
const scriptPath = fileURLToPath(
  new URL("../skills/tensor-book/scripts/codex-rate-limits.mjs", import.meta.url),
);
const fakeServerPath = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));

test("the Codex usage probe normalizes cycle data without exposing credit balances", () => {
  const normalized = normalizeRateLimits({
    rateLimits: {
      limitId: "codex",
      primary: {
        usedPercent: 78,
        windowDurationMins: 10_080,
        resetsAt: capturedAtEpochSeconds + 3_600,
      },
      secondary: null,
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "private-balance",
      },
      spendControlReached: false,
    },
  }, capturedAt);

  assert.deepEqual(normalized.windows, [{
    name: "primary",
    usedPercent: 78,
    remainingPercent: 22,
    windowDurationMinutes: 10_080,
    resetsAtEpochSeconds: capturedAtEpochSeconds + 3_600,
    resetsAt: "2026-09-01T13:00:00.000Z",
  }]);
  assert.equal(normalized.paidExtensionAvailable, true);
  assert.doesNotMatch(JSON.stringify(normalized), /private-balance/);
});

test("the Codex usage probe fails closed when no usable window exists", () => {
  assert.throws(
    () => normalizeRateLimits({ rateLimits: { primary: null, secondary: null } }),
    /no usable rate-limit window/i,
  );
});

test("the Codex usage probe rejects malformed or implausible cycle data", () => {
  const validWindow = {
    usedPercent: 50,
    windowDurationMins: 60,
    resetsAt: capturedAtEpochSeconds + 1_800,
  };

  for (const primary of [
    { ...validWindow, usedPercent: -1 },
    { ...validWindow, usedPercent: 101 },
    { ...validWindow, windowDurationMins: 0 },
    { ...validWindow, resetsAt: capturedAtEpochSeconds },
    { ...validWindow, resetsAt: capturedAtEpochSeconds + 3_601 },
  ]) {
    assert.throws(
      () => normalizeRateLimits({ rateLimits: { primary, secondary: null } }, capturedAt),
      /invalid|expired|implausible/i,
    );
  }
});

test("the Codex usage probe requires an explicit bounded deadline", () => {
  assert.equal(parseDeadline(["--deadline-ms", "2500"], {}), 2_500);
  assert.equal(parseDeadline([], { TENSOR_BOOK_USAGE_PROBE_DEADLINE_MS: "3500" }), 3_500);
  assert.throws(() => parseDeadline([], {}), /positive probe deadline/i);
});

test("the Codex usage probe recognizes direct execution through a symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "tensor-book-probe-link-"));
  const linkedPath = join(directory, "codex-rate-limits.mjs");
  try {
    symlinkSync(scriptPath, linkedPath);
    assert.equal(isDirectExecution(pathToFileURL(scriptPath).href, linkedPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Codex usage probe completes the app-server handshake", async () => {
  const snapshot = await readRateLimits({
    deadlineMs: 2_000,
    command: process.execPath,
    commandArguments: [fakeServerPath, "success"],
  });
  assert.equal(snapshot.limitId, "codex");
  assert.equal(snapshot.windows[0].usedPercent, 75);
});

test("the Codex usage probe terminates a stalled app-server at its deadline", async () => {
  await assert.rejects(
    readRateLimits({
      deadlineMs: 100,
      command: process.execPath,
      commandArguments: [fakeServerPath, "stall"],
    }),
    /exceeded its 100 ms deadline/i,
  );
});
