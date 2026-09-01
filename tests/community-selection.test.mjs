import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommunitySlug } from "../src/lib/community-selection.ts";

test("post composer selects the first loaded community when it opened before data arrived", () => {
  assert.equal(resolveCommunitySlug("", "", []), "");
  assert.equal(resolveCommunitySlug("", "", [{ slug: "debugging" }]), "debugging");
});

test("explicit and initial community choices take precedence over the first option", () => {
  const communities = [{ slug: "debugging" }, { slug: "research" }];
  assert.equal(resolveCommunitySlug("research", "debugging", communities), "research");
  assert.equal(resolveCommunitySlug("", "research", communities), "research");
});
