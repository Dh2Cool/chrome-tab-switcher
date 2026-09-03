import test from "node:test";
import assert from "node:assert/strict";
import {
  cycleSelection,
  displayUrl,
  fallbackLabel,
  initialSelection,
  limitTabs,
  normalizeMru,
  rankTabs,
  recordActivation
} from "../src/core.js";

test("normalizes stale and duplicate MRU entries", () => {
  assert.deepEqual(normalizeMru([3, 2, 3, 9], [1, 2, 3]), [3, 2, 1]);
});

test("records activation at the front", () => {
  assert.deepEqual(recordActivation([3, 2, 1], 2), [2, 3, 1]);
});

test("starts on the previous tab and cycles in either direction", () => {
  assert.equal(initialSelection(5, 1), 1);
  assert.equal(initialSelection(5, -1), 4);
  assert.equal(cycleSelection(4, 5, 1), 0);
  assert.equal(cycleSelection(0, 5, -1), 4);
});

test("ranks tabs by MRU and filters title or URL", () => {
  const tabs = [
    { id: 1, title: "Docs", url: "https://docs.example.com/a" },
    { id: 2, title: "Mail", url: "https://mail.example.com" }
  ];
  assert.deepEqual(rankTabs(tabs, [2, 1]).map(({ id }) => id), [2, 1]);
  assert.deepEqual(rankTabs(tabs, [2, 1], "docs.example").map(({ id }) => id), [1]);
});

test("formats URLs and fallback labels", () => {
  assert.equal(displayUrl("https://example.com/path"), "example.com/path");
  assert.equal(fallbackLabel("  zebra"), "Z");
});

test("limits the switcher to the most recent tabs", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(limitTabs(tabs, 2), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(limitTabs(tabs, 0), []);
});
