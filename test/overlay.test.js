import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/overlay.js", "utf8");
const backgroundSource = await readFile("src/background.js", "utf8");
const popupSource = await readFile("src/popup.js", "utf8");

test("centers the switcher in the viewport", () => {
  assert.match(source, /top:50%/);
  assert.match(source, /left:50%/);
  assert.match(source, /translate\(-50%,-50%\)/);
});

test("reuses five stable card slots", () => {
  assert.match(source, /MAX_VISIBLE_TABS\s*=\s*5/);
  assert.doesNotMatch(source, /replaceChildren/);
});

test("cycles with a selection-only message", () => {
  assert.match(backgroundSource, /type:\s*"select-switcher"/);
  assert.match(source, /message\.type\s*===\s*"select-switcher"/);
});

test("claims opening state before asynchronous setup", () => {
  assert.match(backgroundSource, /directions:\s*\[direction\]/);
  assert.match(backgroundSource, /presentation\s*===\s*"preparing"/);
});

test("installs release handling before capture and detects an already released Alt key", () => {
  const injection = backgroundSource.indexOf("chrome.scripting.executeScript");
  const capture = backgroundSource.indexOf("chrome.tabs.captureVisibleTab");
  assert.ok(injection >= 0 && injection < capture);
  assert.match(source, /event\.key\.toLocaleLowerCase\(\)\s*===\s*"q"/);
  assert.match(source, /RELEASE_FALLBACK_MS\s*=\s*700/);
});

test("limits the popup fallback to the same five MRU tabs", () => {
  assert.match(popupSource, /limitTabs\(rankTabs/);
  assert.match(popupSource, /type:\s*"popup-ready"/);
  assert.match(backgroundSource, /type:\s*"sync-selection"/);
});

test("honors reduced motion and does not animate panel closing", () => {
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /\.panel[^}]*transition:/s);
});
