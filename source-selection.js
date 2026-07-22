export function syncPromptSelectionsFromGroups(groups, currentSelections = {}) {
  const nextSelections = { ...(currentSelections && typeof currentSelections === 'object' ? currentSelections : {}) };
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.loaded || !Array.isArray(group.items)) continue;
    const inactiveWorldbook = group?.scope === '世界书' && group?.category === 'inactive';
    for (const item of group.items) {
      if (!item?.key) continue;
      if (item?.locked) continue;
      nextSelections[item.key] = inactiveWorldbook ? false : item.enabled !== false;
    }
  }
  return nextSelections;
}

export function collectSelectedPromptSourceItems(groups, promptSelections = {}, contentOverrides = {}) {
  const store = promptSelections && typeof promptSelections === 'object' ? promptSelections : {};
  const overrides = contentOverrides && typeof contentOverrides === 'object' ? contentOverrides : {};
  const selected = [];
  const withOverride = (item) => {
    if (!item?.key || !Object.prototype.hasOwnProperty.call(overrides, item.key)) return item;
    return { ...item, content: String(overrides[item.key] ?? '') };
  };
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.loaded || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item?.key) continue;
      const sourceItem = withOverride(item);
      if (!String(sourceItem?.content ?? '').trim() && !String(sourceItem?.markerType ?? '').trim()) continue;
      if (item?.locked) {
        if (item.enabled !== false) selected.push(sourceItem);
        continue;
      }
      const checked = Object.prototype.hasOwnProperty.call(store, item.key) ? store[item.key] !== false : item.enabled !== false;
      if (checked) selected.push(sourceItem);
    }
  }
  return selected;
}
