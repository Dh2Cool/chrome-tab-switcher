import {
  cycleSelection,
  initialSelection,
  limitTabs,
  normalizeMru,
  rankTabs,
  recordActivation
} from "./core.js";
import {
  downscalePreview,
  MAX_PREVIEWS,
  removePreview,
  updatePreviewCache
} from "./preview.js";

const MRU_KEY = "mruTabIds";
const PREVIEW_KEY = "tabPreviews";
let mruIds;
let readPromise;
let pendingWrite;
let updateQueue = Promise.resolve();
let previewCache;
let previewReadPromise;
let previewQueue = Promise.resolve();
let switcherState;

async function readMru() {
  if (!mruIds) {
    readPromise ??= chrome.storage.session.get(MRU_KEY).then((result) => {
      mruIds = Array.isArray(result[MRU_KEY]) ? result[MRU_KEY] : [];
      return mruIds;
    });
    await readPromise;
  }
  return mruIds;
}

function updateMru(transform) {
  updateQueue = updateQueue.then(async () => {
    mruIds = transform(await readMru());
    // Collapse bursts of activation events into one tiny session write. There
    // is no polling: Chrome can suspend this worker whenever it is idle.
    clearTimeout(pendingWrite);
    pendingWrite = setTimeout(() => {
      chrome.storage.session.set({ [MRU_KEY]: mruIds });
    }, 150);
  });
  return updateQueue;
}

async function readPreviews() {
  if (!previewCache) {
    previewReadPromise ??= chrome.storage.session.get(PREVIEW_KEY).then((result) => {
      const stored = result[PREVIEW_KEY];
      previewCache = stored && typeof stored === "object" ? stored : {};
      return previewCache;
    });
    await previewReadPromise;
  }
  return previewCache;
}

function updatePreviews(transform) {
  previewQueue = previewQueue.then(async () => {
    const previous = await readPreviews();
    const next = transform(previous);
    if (next === previous) return previous;
    previewCache = next;
    await chrome.storage.session.set({ [PREVIEW_KEY]: previewCache });
    return previewCache;
  });
  return previewQueue;
}

async function reconcile() {
  const tabs = await chrome.tabs.query({});
  const liveIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  const activeIds = tabs.filter((tab) => tab.active).map((tab) => tab.id);
  await updateMru((ids) => {
    let next = normalizeMru(ids, liveIds);
    for (const id of activeIds.reverse()) next = recordActivation(next, id, liveIds);
    return next;
  });
}

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateMru((ids) => recordActivation(ids, tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateMru((ids) => ids.filter((id) => id !== tabId));
  updatePreviews((cache) => tabId in cache ? removePreview(cache, tabId) : cache);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateMru((ids) => recordActivation(ids.filter((id) => id !== removedTabId), addedTabId));
  updatePreviews((cache) => {
    const preview = cache[removedTabId];
    if (!preview) return cache;
    const next = removePreview(cache, removedTabId);
    return { ...next, [addedTabId]: preview };
  });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "cycle-forward" && command !== "cycle-backward") return;

  const direction = command === "cycle-backward" ? -1 : 1;
  if (switcherState) {
    switcherState.selectedIndex = cycleSelection(
      switcherState.selectedIndex,
      switcherState.tabs.length,
      direction
    );
    if (switcherState.presentation === "overlay") {
      await selectOverlay();
    } else if (switcherState.presentation === "popup") {
      await chrome.runtime.sendMessage({ type: "cycle", direction }).catch(() => {});
    }
    return;
  }

  await openSwitcher(tab, direction);
});

async function openSwitcher(activeTab, direction) {
  if (!activeTab?.id) {
    [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (!activeTab?.id) return;

  const capturePromise = chrome.tabs.captureVisibleTab(activeTab.windowId, {
    format: "jpeg",
    quality: 45
  }).catch(() => undefined);

  await updateQueue;
  const [{ allWindows = false }, previews] = await Promise.all([
    chrome.storage.local.get("allWindows"),
    readPreviews()
  ]);
  const openTabs = await chrome.tabs.query(allWindows ? {} : { windowId: activeTab.windowId });
  const tabs = limitTabs(rankTabs(openTabs, await readMru()), MAX_PREVIEWS);
  if (tabs.length < 2) return;

  const state = {
    presentation: "opening",
    sourceTabId: activeTab.id,
    tabs,
    previews,
    selectedIndex: initialSelection(tabs.length, direction)
  };
  switcherState = state;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["src/overlay.js"]
    });
    state.presentation = "overlay";
    const capturedDataUrl = await capturePromise;
    if (switcherState !== state) return;
    await renderOverlay();

    if (capturedDataUrl) {
      await cacheCapturedPreview(state, activeTab.id, capturedDataUrl);
    }
  } catch {
    if (switcherState !== state) return;
    switcherState.presentation = "popup";
    await chrome.storage.session.set({
      cycleRequest: { direction, requestedAt: Date.now() }
    });
    await chrome.action.openPopup(
      activeTab.windowId ? { windowId: activeTab.windowId } : undefined
    );
  }
}

async function cacheCapturedPreview(state, tabId, capturedDataUrl) {
  try {
    const previewUrl = await downscalePreview(capturedDataUrl);
    const liveTab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!liveTab) return;
    const keepIds = state.tabs.map((tab) => tab.id);
    const previews = await updatePreviews((cache) => (
      updatePreviewCache(cache, tabId, previewUrl, keepIds)
    ));

    if (switcherState === state) {
      state.previews = previews;
      await renderOverlay();
    }
  } catch {
    // Previews are optional; capture failures must not affect tab switching.
  }
}

function publicState() {
  if (!switcherState) return undefined;
  return {
    selectedIndex: switcherState.selectedIndex,
    tabs: switcherState.tabs.map(({ id, title, url, favIconUrl }) => ({
      id,
      title,
      url,
      favIconUrl,
      previewUrl: switcherState.previews[id]
    }))
  };
}

async function renderOverlay() {
  if (!switcherState) return;
  await chrome.tabs.sendMessage(switcherState.sourceTabId, {
    type: "render-switcher",
    state: publicState()
  });
}

async function selectOverlay() {
  if (!switcherState) return;
  await chrome.tabs.sendMessage(switcherState.sourceTabId, {
    type: "select-switcher",
    selectedIndex: switcherState.selectedIndex
  }).catch(() => {});
}

async function finishSwitcher(activate) {
  const state = switcherState;
  switcherState = undefined;
  if (!state) return;

  await chrome.tabs.sendMessage(state.sourceTabId, { type: "close-switcher" }).catch(() => {});
  if (!activate) return;

  const selected = state.tabs[state.selectedIndex];
  if (!selected) return;
  await chrome.tabs.update(selected.id, { active: true });
  await chrome.windows.update(selected.windowId, { focused: true });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "modifier-released") return finishSwitcher(true);
  if (message.type === "cancel-switcher") return finishSwitcher(false);
  if (message.type === "close-selected-tab") {
    if (!switcherState) return undefined;
    const selected = switcherState.tabs[switcherState.selectedIndex];
    if (selected.id === switcherState.sourceTabId) {
      switcherState = undefined;
      return chrome.tabs.remove(selected.id);
    }
    switcherState.tabs.splice(switcherState.selectedIndex, 1);
    switcherState.selectedIndex = Math.min(
      switcherState.selectedIndex,
      switcherState.tabs.length - 1
    );
    return chrome.tabs.remove(selected.id).then(renderOverlay);
  }
  if (message.type !== "activate-tab") return undefined;

  switcherState = undefined;
  return chrome.tabs.update(message.tabId, { active: true }).then(() => (
    chrome.windows.update(message.windowId, { focused: true })
  ));
});
