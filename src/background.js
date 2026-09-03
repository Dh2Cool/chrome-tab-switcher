import {
  cycleSelection,
  limitTabs,
  normalizeMru,
  rankTabs,
  recordActivation,
  selectionFromDirections
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
  updateQueue = updateQueue.catch(() => {}).then(async () => {
    mruIds = transform(await readMru());
    // Collapse bursts of activation events into one tiny session write. There
    // is no polling: Chrome can suspend this worker whenever it is idle.
    clearTimeout(pendingWrite);
    pendingWrite = setTimeout(() => {
      chrome.storage.session.set({ [MRU_KEY]: mruIds }).catch(() => {});
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
  previewQueue = previewQueue.catch(() => {}).then(async () => {
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
    if (
      switcherState.presentation === "preparing" ||
      switcherState.presentation === "popup-opening"
    ) {
      switcherState.directions.push(direction);
      return;
    }
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
  const state = {
    presentation: "preparing",
    directions: [direction],
    releaseRequested: false,
    cancelRequested: false
  };
  switcherState = state;

  try {
    if (!activeTab?.id) {
      [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    if (!activeTab?.id || switcherState !== state) {
      if (switcherState === state) switcherState = undefined;
      return;
    }
    state.sourceTabId = activeTab.id;

    let overlayInjected = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["src/overlay.js"]
      });
      overlayInjected = true;
    } catch {
      // Restricted Chrome pages use the toolbar popup fallback.
    }

    const capturePromise = overlayInjected
      ? chrome.tabs.captureVisibleTab(activeTab.windowId, {
          format: "jpeg",
          quality: 45
        }).catch(() => undefined)
      : Promise.resolve(undefined);

    await updateQueue;
    const [{ allWindows = false }, previews] = await Promise.all([
      chrome.storage.local.get("allWindows"),
      readPreviews()
    ]);
    const openTabs = await chrome.tabs.query(allWindows ? {} : { windowId: activeTab.windowId });
    const tabs = limitTabs(rankTabs(openTabs, await readMru()), MAX_PREVIEWS);

    if (switcherState !== state) return;
    if (tabs.length < 2) {
      switcherState = undefined;
      if (overlayInjected) {
        await chrome.tabs.sendMessage(activeTab.id, { type: "close-switcher" }).catch(() => {});
      }
      return;
    }

    state.tabs = tabs;
    state.previews = previews;
    state.selectedIndex = selectionFromDirections(tabs.length, state.directions);
    if (state.cancelRequested || state.releaseRequested) {
      await finishSwitcher(!state.cancelRequested);
      const capturedDataUrl = await capturePromise;
      if (capturedDataUrl) await cacheCapturedPreview(state, activeTab.id, capturedDataUrl);
      return;
    }

    if (overlayInjected) {
      state.presentation = "overlay-opening";
      const capturedDataUrl = await capturePromise;
      if (switcherState !== state) {
        if (capturedDataUrl) await cacheCapturedPreview(state, activeTab.id, capturedDataUrl);
        return;
      }
      state.presentation = "overlay";
      await renderOverlay();

      if (capturedDataUrl) {
        await cacheCapturedPreview(state, activeTab.id, capturedDataUrl);
      }
      return;
    }

    state.presentation = "popup-opening";
    await chrome.storage.session.set({
      cycleRequest: { directions: [...state.directions], requestedAt: Date.now() }
    });
    await chrome.action.openPopup(
      activeTab.windowId ? { windowId: activeTab.windowId } : undefined
    );
  } catch {
    if (switcherState === state) switcherState = undefined;
    if (state.sourceTabId) {
      await chrome.tabs.sendMessage(state.sourceTabId, { type: "close-switcher" }).catch(() => {});
    }
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

async function syncPopup() {
  const state = switcherState;
  if (state?.presentation !== "popup-opening") return;

  state.selectedIndex = selectionFromDirections(state.tabs.length, state.directions);
  state.presentation = "popup";
  await chrome.runtime.sendMessage({
    type: "sync-selection",
    selectedIndex: state.selectedIndex
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
  if (message.type === "popup-ready") return syncPopup();
  if (message.type === "modifier-released") {
    if (switcherState?.presentation === "preparing") {
      switcherState.releaseRequested = true;
      return undefined;
    }
    return finishSwitcher(true);
  }
  if (message.type === "cancel-switcher") {
    if (switcherState?.presentation === "preparing") {
      switcherState.cancelRequested = true;
      return undefined;
    }
    return finishSwitcher(false);
  }
  if (message.type === "close-selected-tab") {
    if (!switcherState?.tabs) return undefined;
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
