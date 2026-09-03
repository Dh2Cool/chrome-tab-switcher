(() => {
  if (globalThis.recentTabsOverlay) return;

  const MAX_VISIBLE_TABS = 5;
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  document.documentElement.append(host);

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}[hidden]{display:none!important}
    .panel{position:absolute;top:50%;left:50%;width:min(880px,calc(100vw - 32px));transform:translate(-50%,-50%);padding:16px 18px 13px;border:1px solid #ffffff2e;border-radius:22px;background:#292824fa;color:#f7f4ec;box-shadow:0 22px 64px #0009;font:13px/1.35 system-ui,sans-serif}
    .tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
    .tab{display:grid;min-width:0;gap:7px;padding:6px 6px 8px;border:2px solid transparent;border-radius:15px;background:#ffffff0a;transform:translateY(0);transition:transform 90ms cubic-bezier(.2,.8,.2,1),border-color 90ms ease-out,background-color 90ms ease-out,box-shadow 90ms ease-out}
    .tab.selected{border-color:#fff;background:#ffffff18;box-shadow:0 9px 22px #0005;transform:translateY(-3px)}
    .preview-frame{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:10px;background:#1d1c1a}
    .preview,.fallback{position:absolute;inset:0;width:100%;height:100%}
    .preview{display:block;object-fit:cover}
    .fallback{display:grid;place-items:center;background:linear-gradient(145deg,#4e4776,#27252e);color:#fff;font-size:28px;font-weight:800}
    .favicon{position:absolute;bottom:6px;left:6px;width:24px;height:24px;padding:3px;border:1px solid #0002;border-radius:7px;background:#f7f4ec;box-shadow:0 2px 8px #0007;object-fit:contain}
    .label{width:100%;overflow:hidden;padding:0 3px;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:650}
    .title{height:35px;overflow:hidden;padding:11px 8px 7px;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
    .hint{padding-top:8px;border-top:1px solid #ffffff1f;color:#c2beb5;text-align:center;font-size:11px}
    kbd{padding:1px 5px;border:1px solid #ffffff42;border-radius:5px;font:10px ui-monospace,monospace}
    @media (prefers-reduced-motion:reduce){.tab{transition:none}}
  `;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Recent tabs");

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  tabs.setAttribute("role", "listbox");

  const title = document.createElement("div");
  title.className = "title";
  title.setAttribute("aria-live", "polite");

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.innerHTML = "Hold <kbd>Alt</kbd> · tap <kbd>Q</kbd> · <kbd>Shift</kbd> reverse · <kbd>W</kbd> close · <kbd>Esc</kbd> cancel";

  const cardSlots = Array.from({ length: MAX_VISIBLE_TABS }, createCard);
  let renderedTabs = [];
  for (const slot of cardSlots) tabs.append(slot.element);
  panel.append(tabs, title, hint);
  shadow.append(style, panel);

  function createCard() {
    const element = document.createElement("div");
    element.className = "tab";
    element.setAttribute("role", "option");

    const previewFrame = document.createElement("div");
    previewFrame.className = "preview-frame";

    const preview = document.createElement("img");
    preview.className = "preview";
    preview.alt = "";
    preview.hidden = true;

    const fallback = document.createElement("span");
    fallback.className = "fallback";

    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.alt = "";
    favicon.hidden = true;

    const label = document.createElement("span");
    label.className = "label";

    previewFrame.append(preview, fallback, favicon);
    element.append(previewFrame, label);

    const slot = {
      element,
      preview,
      fallback,
      favicon,
      label,
      tabId: undefined,
      previewUrl: undefined,
      faviconUrl: undefined
    };

    preview.addEventListener("error", () => {
      preview.hidden = true;
      fallback.hidden = false;
    });
    favicon.addEventListener("error", () => {
      favicon.hidden = true;
    });
    return slot;
  }

  function fallbackLabel(tab) {
    const source = tab.title?.trim() || tab.url || "?";
    return (source.match(/[\p{L}\p{N}]/u)?.[0] || "?").toLocaleUpperCase();
  }

  function updateCard(slot, tab) {
    slot.element.hidden = !tab;
    if (!tab) return;

    if (slot.tabId !== tab.id) {
      slot.tabId = tab.id;
      slot.label.textContent = tab.title || "Untitled";
      slot.fallback.textContent = fallbackLabel(tab);
    }

    if (slot.previewUrl !== tab.previewUrl) {
      slot.previewUrl = tab.previewUrl;
      slot.preview.hidden = !tab.previewUrl;
      slot.fallback.hidden = Boolean(tab.previewUrl);
      if (tab.previewUrl) slot.preview.src = tab.previewUrl;
      else slot.preview.removeAttribute("src");
    }

    if (slot.faviconUrl !== tab.favIconUrl) {
      slot.faviconUrl = tab.favIconUrl;
      slot.favicon.hidden = !tab.favIconUrl;
      if (tab.favIconUrl) slot.favicon.src = tab.favIconUrl;
      else slot.favicon.removeAttribute("src");
    }

  }

  function render(state) {
    renderedTabs = state.tabs;
    for (let index = 0; index < MAX_VISIBLE_TABS; index += 1) {
      updateCard(cardSlots[index], state.tabs[index]);
    }

    select(state.selectedIndex);
    panel.hidden = false;
  }

  function select(selectedIndex) {
    for (let index = 0; index < MAX_VISIBLE_TABS; index += 1) {
      const selected = index === selectedIndex && Boolean(renderedTabs[index]);
      cardSlots[index].element.classList.toggle("selected", selected);
      cardSlots[index].element.setAttribute("aria-selected", String(selected));
    }
    title.textContent = renderedTabs[selectedIndex]?.title || "";
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
    if (message.type === "select-switcher") select(message.selectedIndex);
    if (message.type === "close-switcher") close();
  }

  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.recentTabsOverlay = { close };
})();
