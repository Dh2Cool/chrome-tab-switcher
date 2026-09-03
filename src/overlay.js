(() => {
  if (globalThis.recentTabsOverlay) return;

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  document.documentElement.append(host);

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box} .panel{position:absolute;top:38%;left:50%;width:min(760px,calc(100vw - 32px));transform:translate(-50%,-50%);padding:18px 20px 14px;border:1px solid #ffffff2e;border-radius:24px;background:#292824f2;color:#f7f4ec;box-shadow:0 22px 70px #0008;font:13px/1.35 system-ui,sans-serif;backdrop-filter:blur(22px)}
    .tabs{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}.tab{display:grid;min-width:0;height:112px;place-items:center;padding:10px 7px 7px;border:4px solid transparent;border-radius:18px}.tab.selected{border-color:#fff;background:#ffffff17;box-shadow:0 10px 24px #0005}.icon,.fallback{width:48px;height:48px}.icon{object-fit:contain}.fallback{display:grid;place-items:center;border-radius:13px;background:#6756e8;color:#fff;font-size:23px;font-weight:800}.label{width:100%;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:650}.title{height:37px;overflow:hidden;padding:12px 8px 8px;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.hint{padding-top:9px;border-top:1px solid #ffffff1f;color:#c2beb5;text-align:center;font-size:11px}kbd{padding:1px 5px;border:1px solid #ffffff42;border-radius:5px;font:10px ui-monospace,monospace}
  `;

  const panel = document.createElement("section");
  panel.className = "panel";
  shadow.append(style, panel);

  function fallbackLabel(tab) {
    const source = tab.title?.trim() || tab.url || "?";
    return (source.match(/[\p{L}\p{N}]/u)?.[0] || "?").toLocaleUpperCase();
  }

  function visibleTabs(state) {
    if (state.tabs.length <= 7) return state.tabs.map((tab, index) => ({ tab, index }));
    return Array.from({ length: 7 }, (_, offset) => {
      const index = (state.selectedIndex - 3 + offset + state.tabs.length) % state.tabs.length;
      return { tab: state.tabs[index], index };
    });
  }

  function render(state) {
    const tabs = document.createElement("div");
    tabs.className = "tabs";

    for (const { tab, index } of visibleTabs(state)) {
      const tile = document.createElement("div");
      tile.className = `tab${index === state.selectedIndex ? " selected" : ""}`;
      const fallback = document.createElement("span");
      fallback.className = "fallback";
      fallback.textContent = fallbackLabel(tab);

      if (tab.favIconUrl) {
        const icon = document.createElement("img");
        icon.className = "icon";
        icon.src = tab.favIconUrl;
        icon.alt = "";
        icon.addEventListener("error", () => icon.replaceWith(fallback));
        tile.append(icon);
      } else {
        tile.append(fallback);
      }

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = tab.title || "Untitled";
      tile.append(label);
      tabs.append(tile);
    }

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = state.tabs[state.selectedIndex]?.title || "";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.innerHTML = "Hold <kbd>Alt</kbd> · tap <kbd>Q</kbd> · <kbd>Shift</kbd> reverse · <kbd>W</kbd> close · <kbd>Esc</kbd> cancel";
    panel.replaceChildren(tabs, title, hint);
  }

  function close() {
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    chrome.runtime.onMessage.removeListener(onMessage);
    host.remove();
    delete globalThis.recentTabsOverlay;
  }

  function onKeyUp(event) {
    if (event.key === "Alt") chrome.runtime.sendMessage({ type: "modifier-released" });
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      chrome.runtime.sendMessage({ type: "cancel-switcher" });
    } else if (event.key.toLocaleLowerCase() === "w" && event.altKey) {
      event.preventDefault();
      chrome.runtime.sendMessage({ type: "close-selected-tab" });
    }
  }

  function onMessage(message) {
    if (message.type === "render-switcher") render(message.state);
    if (message.type === "close-switcher") close();
  }

  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.recentTabsOverlay = { close };
})();
