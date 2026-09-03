import test from "node:test";
import assert from "node:assert/strict";
import { removePreview, updatePreviewCache } from "../src/preview.js";

test("adds a preview and prunes outside the bounded MRU set", () => {
  const cache = updatePreviewCache(
    { 1: "one", 2: "two" },
    3,
    "three",
    [3, 2, 1],
    2
  );

  assert.deepEqual(cache, { 2: "two", 3: "three" });
});

test("removes a preview without mutating the cache", () => {
  const cache = { 1: "one", 2: "two" };
  assert.deepEqual(removePreview(cache, 1), { 2: "two" });
  assert.deepEqual(cache, { 1: "one", 2: "two" });
});
