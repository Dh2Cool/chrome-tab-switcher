# Lightweight Tab Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five lightweight cached tab screenshots and a stable, exactly centered switcher overlay.

**Architecture:** The background worker captures only the active outgoing tab at gesture start, downsizes it with worker-native image APIs, and keeps five ephemeral session entries. The injected overlay creates five reusable cards once and updates their content and selection in place.

**Tech Stack:** Chrome Manifest V3 APIs, JavaScript ES modules, Shadow DOM, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-09-03-lightweight-tab-previews-design.md`

## Global Constraints

- Keep only the existing `activeTab`, `scripting`, `storage`, and `tabs` permissions.
- Add no dependencies, host permissions, persistent content scripts, timers, polling, or analytics.
- Capture at most once per switcher session and retain at most five 320 by 180 JPEG previews.
- Preview failures must never block tab switching.

---

### Task 1: Preview cache and five-tab limit

**Files:**
- Create: `src/preview.js`
- Modify: `src/core.js`
- Create: `test/preview.test.js`
- Modify: `test/core.test.js`

**Interfaces:**
- Produces: `limitTabs(tabs, maximum)` returning the first bounded set of tabs.
- Produces: `updatePreviewCache(cache, tabId, dataUrl, keepIds, maximum)` returning a pruned immutable map.
- Produces: `removePreview(cache, tabId)` returning an immutable map without that tab.
- Produces: `downscalePreview(dataUrl)` returning a 320 by 180 JPEG data URL.

- [ ] **Step 1: Write failing tests for the five-tab limit and preview pruning**

```js
assert.deepEqual(limitTabs([{ id: 1 }, { id: 2 }], 1), [{ id: 1 }]);
assert.deepEqual(
  updatePreviewCache({ 1: "one", 2: "two" }, 3, "three", [3, 2, 1], 2),
  { 2: "two", 3: "three" }
);
assert.deepEqual(removePreview({ 1: "one", 2: "two" }, 1), { 2: "two" });
```

- [ ] **Step 2: Run `npm test` and confirm the new imports fail**

Expected: FAIL because `limitTabs`, `updatePreviewCache`, and `removePreview` do not exist.

- [ ] **Step 3: Implement the pure helpers and worker image downscaling**

```js
export const MAX_PREVIEWS = 5;
export const PREVIEW_WIDTH = 320;
export const PREVIEW_HEIGHT = 180;

export function updatePreviewCache(cache, tabId, dataUrl, keepIds, maximum = MAX_PREVIEWS) {
  const keep = new Set(keepIds.slice(0, maximum));
  const next = {};
  for (const [id, preview] of Object.entries({ ...cache, [tabId]: dataUrl })) {
    if (keep.has(Number(id))) next[id] = preview;
  }
  return next;
}
```

Use `createImageBitmap`, `OffscreenCanvas.drawImage`, `convertToBlob`, and an ArrayBuffer-to-data-URL helper. Always close the decoded bitmap in `finally`.

- [ ] **Step 4: Run `npm test` and confirm all cache tests pass**

Expected: all Node tests pass without calling browser image APIs.

- [ ] **Step 5: Commit the independently tested helpers**

```sh
git add src/core.js src/preview.js test/core.test.js test/preview.test.js
git commit -m "Add bounded tab preview cache"
```

### Task 2: Background capture lifecycle

**Files:**
- Modify: `src/background.js`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `test/preview.test.js`

**Interfaces:**
- Consumes: `limitTabs`, `downscalePreview`, `updatePreviewCache`, and `removePreview` from Task 1.
- Produces: public switcher tab objects with optional `previewUrl` fields.

- [ ] **Step 1: Add a failing source-level test for one capture at gesture start**

```js
const source = await readFile("src/background.js", "utf8");
assert.match(source, /captureVisibleTab/);
assert.match(source, /previewUrl/);
```

- [ ] **Step 2: Run `npm test` and confirm the capture test fails**

Expected: FAIL because background capture is not implemented.

- [ ] **Step 3: Capture before injection and attach cached previews**

At the beginning of `openSwitcher`, start one `captureVisibleTab(activeTab.windowId, { format: "jpeg", quality: 45 })` request. Limit ranked tabs to five, read `tabPreviews` from session storage, and render immediately after the capture request resolves. Process and persist the captured image asynchronously; if the same switcher is still open, update its source tab and send one additional render.

Remove cached entries in `tabs.onRemoved` and migrate the entry in `tabs.onReplaced`. Wrap the entire enhancement path in error handling so capture failures leave the switcher functional.

- [ ] **Step 4: Bump the extension and package versions to `0.4.0`**

Update both `manifest.json` and `package.json` without changing permissions.

- [ ] **Step 5: Run tests and structural checks**

Run: `npm test && npm run check`

Expected: all tests pass and the checker reports no host permissions.

- [ ] **Step 6: Commit the capture lifecycle**

```sh
git add src/background.js manifest.json package.json test/preview.test.js
git commit -m "Capture lightweight active tab previews"
```

### Task 3: Stable centered preview renderer

**Files:**
- Modify: `src/overlay.js`
- Create: `test/overlay.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: switcher state containing no more than five tabs with optional `previewUrl`.
- Produces: an isolated five-card overlay that reports the existing modifier, cancel, and close messages unchanged.

- [ ] **Step 1: Write failing overlay invariants**

```js
const source = await readFile("src/overlay.js", "utf8");
assert.match(source, /top:50%/);
assert.match(source, /MAX_VISIBLE_TABS\s*=\s*5/);
assert.doesNotMatch(source, /replaceChildren/);
```

- [ ] **Step 2: Run `npm test` and confirm centering and stable-DOM failures**

Expected: FAIL because the panel is at 38%, renders seven cards, and replaces its children.

- [ ] **Step 3: Build five card slots once and update them in place**

Create the tabs container, five card records, selected title, and hint during initialization. Each card record owns its preview image, favicon, fallback, and label. On render, change image sources only when its assigned tab or preview URL differs; for ordinary cycling, update only `selected`, `aria-selected`, and the selected title.

- [ ] **Step 4: Apply exact centering and compositor-friendly styling**

Use `top:50%; left:50%; transform:translate(-50%,-50%)`. Display 16:9 previews with `object-fit:cover`; animate selected-card `transform`, border, background, and shadow for 90ms; disable transitions under `prefers-reduced-motion`; do not animate panel opening or closing.

- [ ] **Step 5: Document progressive previews and the five-entry cache**

Explain that previews appear after a tab has been active during a switcher invocation, remain session-only, and require no all-sites access.

- [ ] **Step 6: Run the complete verification and package commands**

Run: `npm test && npm run check && npm run package`

Expected: all tests and checks pass, and `dist/recent-tabs-switcher.zip` is recreated.

- [ ] **Step 7: Commit and push the feature**

```sh
git add src/overlay.js test/overlay.test.js README.md dist/recent-tabs-switcher.zip
git commit -m "Render smooth centered tab previews"
git push origin main
```
