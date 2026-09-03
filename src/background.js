import { normalizeMru, recordActivation } from "./core.js";

const MRU_KEY = "mruTabIds";
let mruIds;
let readPromise;
let pendingWrite;
let updateQueue = Promise.resolve();

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
  await updateQueue;
  await chrome.storage.session.set({
    [MRU_KEY]: await readMru(),
    cycleRequest: { direction, requestedAt: Date.now() }
  });

  try {
    await chrome.runtime.sendMessage({ type: "cycle", direction });
  } catch {
    await chrome.action.openPopup(tab?.windowId ? { windowId: tab.windowId } : undefined);
  }
});
