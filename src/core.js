export function normalizeMru(ids, liveIds) {
  const live = new Set(liveIds);
  const seen = new Set();
  const result = [];

  for (const id of [...ids, ...liveIds]) {
    if (live.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export function recordActivation(ids, tabId, liveIds = null) {
  const next = [tabId, ...ids.filter((id) => id !== tabId)];
  return liveIds ? normalizeMru(next, liveIds) : next;
}

export function initialSelection(tabCount, direction) {
  if (tabCount < 2) return 0;
  return direction < 0 ? tabCount - 1 : 1;
}

export function cycleSelection(index, tabCount, direction) {
  if (!tabCount) return 0;
  return (index + direction + tabCount) % tabCount;
}

export function selectionFromDirections(tabCount, directions) {
  if (!directions.length) return 0;
  let selectedIndex = initialSelection(tabCount, directions[0]);
  for (const direction of directions.slice(1)) {
    selectedIndex = cycleSelection(selectedIndex, tabCount, direction);
  }
  return selectedIndex;
}

export function limitTabs(tabs, maximum) {
  return tabs.slice(0, Math.max(0, maximum));
}

export function rankTabs(tabs, mruIds, query = "") {
  const order = new Map(mruIds.map((id, index) => [id, index]));
  const needle = query.trim().toLocaleLowerCase();

  return tabs
    .map((tab, originalIndex) => ({ tab, originalIndex }))
    .filter(({ tab }) => {
      if (!needle) return true;
      return `${tab.title ?? ""} ${displayUrl(tab.url)}`
        .toLocaleLowerCase()
        .includes(needle);
    })
    .sort((a, b) => {
      const aRank = order.get(a.tab.id) ?? Number.MAX_SAFE_INTEGER;
      const bRank = order.get(b.tab.id) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank || a.originalIndex - b.originalIndex;
    })
    .map(({ tab }) => tab);
}

export function displayUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome:") return parsed.href;
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function fallbackLabel(title = "", url = "") {
  const source = title.trim() || displayUrl(url);
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toLocaleUpperCase();
}
