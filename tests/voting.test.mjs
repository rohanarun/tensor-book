import assert from "node:assert/strict";
import test from "node:test";

import {
  nextVoteChoice,
  parseVoteChoices,
  readVoteChoices,
  saveVoteChoices,
  voteChoiceFromValue,
  voteScoreDelta,
  withVoteChoice,
} from "../src/lib/voting.ts";

test("guest vote state toggles immediately and computes the optimistic score delta", () => {
  assert.equal(nextVoteChoice(null, "up"), "up");
  assert.equal(nextVoteChoice("up", "up"), null);
  assert.equal(nextVoteChoice("up", "down"), "down");
  assert.equal(voteScoreDelta(null, "up"), 1);
  assert.equal(voteScoreDelta("up", null), -1);
  assert.equal(voteScoreDelta("up", "down"), -2);
  assert.equal(voteChoiceFromValue(1), "up");
  assert.equal(voteChoiceFromValue(-1), "down");
  assert.equal(voteChoiceFromValue(0), null);
});

test("guest vote selections persist only valid device-local choices", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const selected = withVoteChoice({}, "post-a", "up");
  saveVoteChoices(selected, storage);
  assert.deepEqual(readVoteChoices(storage), { "post-a": "up" });
  assert.deepEqual(withVoteChoice(selected, "post-a", null), {});
  assert.deepEqual(parseVoteChoices('{"post-a":"up","post-b":"invalid"}'), { "post-a": "up" });
  assert.deepEqual(parseVoteChoices("not-json"), {});
});
