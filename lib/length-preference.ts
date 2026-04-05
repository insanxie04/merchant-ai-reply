export const LENGTH_PREFERENCE_IDS = ["short", "medium", "long"] as const;

export type LengthPreferenceId = (typeof LENGTH_PREFERENCE_IDS)[number];

export const LENGTH_PREFERENCE_OPTIONS: {
  id: LengthPreferenceId;
  label: string;
  min: number;
  max: number;
}[] = [
  { id: "short", label: "简短（30-80字）", min: 30, max: 80 },
  { id: "medium", label: "适中（80-150字）", min: 80, max: 150 },
  { id: "long", label: "详细（150-250字）", min: 150, max: 250 },
];

/** 供 Base UI Select `items` 使用，触发器展示中文 label 而非英文 value */
export const LENGTH_PREFERENCE_SELECT_ITEMS: ReadonlyArray<{
  value: LengthPreferenceId;
  label: string;
}> = LENGTH_PREFERENCE_OPTIONS.map((o) => ({
  value: o.id,
  label: o.label,
}));

export function lengthBounds(
  id: string | undefined
): { min: number; max: number; label: string } {
  const found = LENGTH_PREFERENCE_OPTIONS.find((o) => o.id === id);
  return found ?? LENGTH_PREFERENCE_OPTIONS[1];
}
