/** 分组展示用；扁平列表用于校验与存储 */
export const CATEGORY_GROUPS: readonly {
  readonly label: string;
  readonly items: readonly string[];
}[] = [
  { label: "餐饮美食", items: ["餐饮", "奶茶咖啡", "生鲜果蔬"] },
  { label: "生活服务", items: ["丽人", "酒店住宿", "生活服务", "电商"] },
  { label: "休闲娱乐", items: ["休闲娱乐"] },
] as const;

/** 商家品类预设（不含「其他」入口；自定义内容由用户输入） */
export const CATEGORY_PRESET_LIST = CATEGORY_GROUPS.flatMap((g) => [...g.items]);

export type CategoryPreset = (typeof CATEGORY_PRESET_LIST)[number];

export const CATEGORY_PRESET_SET = new Set<string>(CATEGORY_PRESET_LIST);
