import { cycleSelection, fallbackLabel, initialSelection, rankTabs } from "./core.js";

const MAX_VISIBLE_TABS = 7;
const RELEASE_FALLBACK_MS = 450;
const list = document.querySelector("#tabs");
const position = document.querySelector("#position");
const selectedTitle = document.querySelector("#title");

let tabs = [];
let selectedIndex = 0;
let cancelled = false;
let activating = false;
let gestureMode = false;
let commitTimer;

async function load() {
  const [{ allWindows = false }, session] = await Promise.all([
    chrome.storage.local.get("allWindows"),
    chrome.storage.session.get(["mruTabIds", "cycleRequest"])
  ]);
  const openTabs = await chrome.tabs.query(allWindows ? {} : { currentWindow: true });
  tabs = rankTabs(openTabs, session.mruTabIds ?? []);

  const request = session.cycleRequest;
  gestureMode = Boolean(request && Date.now() - request.requestedAt < 1500);
  const direction = gestureMode ? request.direction : 1;
  selectedIndex = initialSelection(tabs.length, direction);
  await chrome.storage.session.remove("cycleRequest");
  render();
  scheduleCommit();
}

function visibleRange() {
  if (tabs.length <= MAX_VISIBLE_TABS) return tabs.map((tab, index) => ({ tab, index }));
  const before = Math.floor(MAX_VISIBLE_TABS / 2);
  return Array.from({ length: MAX_VISIBLE_TABS }, (_, offset) => {
    const index = (selectedIndex - before + offset + tabs.length) % tabs.length;
    return { tab: tabs[index], index };
  });
}

function render() {
  list.replaceChildren();
  const fragment = document.createDocumentFragment();

  if (!tabs.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No tabs to switch.";
    fragment.append(empty);
  } else {
    for (const { tab, index } of visibleRange()) fragment.append(createTile(tab, index));
  }

  list.append(fragment);
  const selected = tabs[selectedIndex];
  selectedTitle.textContent = selected?.title || "";
  position.textContent = tabs.length ? `${selectedIndex + 1} of ${tabs.length}` : "";
}

function createTile(tab, index) {
  const tile = document.createElement("li");
  tile.className = `tab${index === selectedIndex ? " selected" : ""}`;
  tile.setAttribute("role", "option");
  tile.setAttribute("aria-selected", String(index === selectedIndex));

  const fallback = document.createElement("span");
  fallback.className = "fallback";
  fallback.textContent = fallbackLabel(tab.title, tab.url);

  if (tab.favIconUrl) {
    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.alt = "";
    icon.src = tab.favIconUrl;
    icon.addEventListener("error", () => icon.replaceWith(fallback));
    tile.append(icon);
  } else {
    tile.append(fallback);
  }

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = tab.title || "Untitled";
  tile.append(label);
  tile.addEventListener("click", () => activate(index));
  tile.addEventListener("mousemove", () => {
    if (index !== selectedIndex) {
      selectedIndex = index;
      render();
    }
  });
  return tile;
}

function cycle(direction) {
  selectedIndex = cycleSelection(selectedIndex, tabs.length, direction);
  render();
  gestureMode = true;
  scheduleCommit();
}

function scheduleCommit() {
  clearTimeout(commitTimer);
  if (gestureMode) commitTimer = setTimeout(activate, RELEASE_FALLBACK_MS);
}

async function activate(index = selectedIndex) {
  if (cancelled || activating || !tabs[index]) return;
  activating = true;
  clearTimeout(commitTimer);
  const tab = tabs[index];
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  window.close();
}

async function closeSelected() {
  const tab = tabs[selectedIndex];
  if (!tab) return;
  await chrome.tabs.remove(tab.id);
  tabs.splice(selectedIndex, 1);
  selectedIndex = Math.min(selectedIndex, Math.max(tabs.length - 1, 0));
  if (!tabs.length) window.close();
  else {
    render();
    scheduleCommit();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "cycle") cycle(message.direction);
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Alt") activate();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cancelled = true;
    clearTimeout(commitTimer);
    window.close();
  } else if (event.key.toLocaleLowerCase() === "w" || event.key === "Delete") {
    event.preventDefault();
    closeSelected();
  } else if (event.key === "ArrowRight" || event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    cycle(1);
  } else if (event.key === "ArrowLeft" || event.key === "Tab" && event.shiftKey) {
    event.preventDefault();
    cycle(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    activate();
  }
});

window.addEventListener("blur", () => {
  if (!cancelled && !activating) activate();
});

load();
