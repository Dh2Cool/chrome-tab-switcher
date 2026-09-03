import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/overlay.js", "utf8");
const backgroundSource = await readFile("src/background.js", "utf8");

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

test("honors reduced motion and does not animate panel closing", () => {
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /\.panel[^}]*transition:/s);
});
