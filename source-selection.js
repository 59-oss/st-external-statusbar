export function syncPromptSelectionsFromGroups(groups, currentSelections = {}) {
  const nextSelections = { ...(currentSelections && typeof currentSelections === 'object' ? currentSelections : {}) };
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.loaded || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item?.key) continue;
      if (item?.locked) continue;
      nextSelections[item.key] = item.enabled !== false;
    }
  }
  return nextSelections;
}

export function collectSelectedPromptSourceItems(groups, promptSelections = {}) {
  const store = promptSelections && typeof promptSelections === 'object' ? promptSelections : {};
  const selected = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.loaded || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item?.key) continue;
      if (!String(item?.content ?? '').trim() && !String(item?.markerType ?? '').trim()) continue;
      if (item?.locked) {
        if (item.enabled !== false) selected.push(item);
        continue;
      }
      const checked = Object.prototype.hasOwnProperty.call(store, item.key) ? store[item.key] !== false : item.enabled !== false;
      if (checked) selected.push(item);
    }
  }
  return selected;
}
