export function syncPromptSelectionsFromGroups(groups, currentSelections = {}) {
  const nextSelections = { ...(currentSelections && typeof currentSelections === 'object' ? currentSelections : {}) };
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.loaded || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item?.key) continue;
      nextSelections[item.key] = item.enabled !== false;
    }
  }
  return nextSelections;
}
