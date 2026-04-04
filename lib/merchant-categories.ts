/** 商家品类预设（不含「其他」入口；自定义内容由用户输入） */
export const CATEGORY_PRESET_LIST = [
  "餐饮",
  "奶茶咖啡",
  "丽人",
  "休闲娱乐",
  "酒店住宿",
  "生鲜果蔬",
  "生活服务",
] as const;

export type CategoryPreset = (typeof CATEGORY_PRESET_LIST)[number];

export const CATEGORY_PRESET_SET = new Set<string>(CATEGORY_PRESET_LIST);
