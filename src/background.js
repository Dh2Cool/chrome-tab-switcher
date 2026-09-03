import {
  cycleSelection,
  initialSelection,
  normalizeMru,
  rankTabs,
  recordActivation
} from "./core.js";

const MRU_KEY = "mruTabIds";
let mruIds;
let readPromise;
let pendingWrite;
let updateQueue = Promise.resolve();
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
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  updateMru((ids) => recordActivation(ids.filter((id) => id !== removedTabId), addedTabId));
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
      await renderOverlay();
    } else {
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

  await updateQueue;
  const { allWindows = false } = await chrome.storage.local.get("allWindows");
  const openTabs = await chrome.tabs.query(allWindows ? {} : { windowId: activeTab.windowId });
  const tabs = rankTabs(openTabs, await readMru());
  if (tabs.length < 2) return;

  switcherState = {
    presentation: "overlay",
    sourceTabId: activeTab.id,
    tabs,
    selectedIndex: initialSelection(tabs.length, direction)
  };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["src/overlay.js"]
    });
    await renderOverlay();
  } catch {
    switcherState.presentation = "popup";
    await chrome.storage.session.set({
      cycleRequest: { direction, requestedAt: Date.now() }
    });
    await chrome.action.openPopup(
      activeTab.windowId ? { windowId: activeTab.windowId } : undefined
    );
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
      favIconUrl
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
