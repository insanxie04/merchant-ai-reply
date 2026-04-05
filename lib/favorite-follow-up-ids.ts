/** 跟进卡片编辑/菜单状态键（UUID 中不含 ::） */
export function followUpRowUiKey(
  favoriteId: string,
  followUpId: string,
  rowId: string
): string {
  return `fu::${favoriteId}::${followUpId}::${rowId}`;
}

export function parseFollowUpRowUiKey(
  key: string
): { favoriteId: string; followUpId: string; rowId: string } | null {
  if (!key.startsWith("fu::")) return null;
  const parts = key.split("::");
  if (parts.length !== 4) return null;
  return { favoriteId: parts[1], followUpId: parts[2], rowId: parts[3] };
}

/** 收藏夹内跟进回复与顶层收藏去重用的 replyRowId */
export function followUpRowFavoriteId(
  favoriteId: string,
  followUpId: string,
  rowId: string
): string {
  return `fup::${favoriteId}::${followUpId}::${rowId}`;
}

export function parseFollowUpRowFavoriteId(
  id: string
): { favoriteId: string; followUpId: string; rowId: string } | null {
  if (!id.startsWith("fup::")) return null;
  const parts = id.split("::");
  if (parts.length !== 4) return null;
  return { favoriteId: parts[1], followUpId: parts[2], rowId: parts[3] };
}
