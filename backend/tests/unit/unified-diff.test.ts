import assert from "node:assert/strict";
import test from "node:test";
import { countPatchChanges, parseUnifiedDiff } from "../../src/modules/diff/domain/unified-diff.js";

test("countPatchChanges counts additions/deletions", () => {
  const patch = [
    "@@ -1,3 +1,4 @@",
    " line1",
    "-line2",
    "+line2_new",
    "+line3",
  ].join("\n");

  const result = countPatchChanges(patch);
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 1);
});

test("parseUnifiedDiff returns hunks and line map", () => {
  const patch = [
    "@@ -10,2 +10,3 @@",
    " old",
    "-removed",
    "+added",
    "+added2",
  ].join("\n");

  const result = parseUnifiedDiff(patch);

  assert.equal(result.hunks.length, 1);
  assert.equal(result.hunks[0]?.newStart, 10);
  assert.equal(result.lineMap.filter((entry) => entry.type === "add").length, 2);
  assert.equal(result.lineMap.filter((entry) => entry.type === "del").length, 1);
});
