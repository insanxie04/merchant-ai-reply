/**
 * 与网页版保持一致的选项（不含任何第三方平台绑定文案）
 */

/** 商家品类预设（最后一项「其他」由 picker 单独追加） */
const CATEGORY_PRESET_LIST = [
  "餐饮",
  "奶茶咖啡",
  "丽人",
  "休闲娱乐",
  "酒店住宿",
  "生鲜果蔬",
  "生活服务",
  "电商",
];

/** 回复风格预设（最后一项「自定义人设」由 picker 单独追加） */
const PRESET_STYLE_LIST = [
  "亲切热情",
  "专业正式",
  "幽默风趣",
  "简洁干练",
  "真诚走心",
];

const RATING_TYPES = ["好评", "中评", "差评"];

/** 展示用：品类 picker 的 range */
function getCategoryPickerRange() {
  return CATEGORY_PRESET_LIST.concat(["其他（可自定义）"]);
}

/** 展示用：风格 picker 的 range */
function getStylePickerRange() {
  return PRESET_STYLE_LIST.concat(["自定义人设（可编辑）"]);
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

module.exports = {
  CATEGORY_PRESET_LIST,
  PRESET_STYLE_LIST,
  RATING_TYPES,
  getCategoryPickerRange,
  getStylePickerRange,
  MAX_IMAGE_BYTES,
};
