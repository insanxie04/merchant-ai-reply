/**
 * 收藏数据：仅本地 wx.storage，与网页 localStorage 结构对齐（v2 + items）
 * 不采集任何用户身份信息
 */

const STORAGE_KEY = "dianping-xiaobang-favorites-v2";
const LEGACY_KEY = "dianping-xiaobang-favorites-v1";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function isBucket(s) {
  return s === "praise" || s === "neutral" || s === "negative";
}

function normalizeItem(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.id !== "string" || typeof row.text !== "string") return null;
  const savedAt =
    typeof row.savedAt === "number" && Number.isFinite(row.savedAt)
      ? row.savedAt
      : Date.now();
  const bucket = isBucket(row.bucket) ? row.bucket : "praise";
  const note = typeof row.note === "string" ? row.note : "";
  const replyRowId =
    typeof row.replyRowId === "string" ? row.replyRowId : undefined;
  return { id: row.id, text: row.text, savedAt, bucket, note, replyRowId };
}

/** 读取收藏列表 */
function loadFavorites() {
  try {
    let raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) raw = wx.getStorageSync(LEGACY_KEY);
    if (!raw) return [];
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(data)) {
      return data
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          if (typeof row.id !== "string" || typeof row.text !== "string")
            return null;
          return {
            id: row.id,
            text: row.text,
            savedAt:
              typeof row.savedAt === "number" ? row.savedAt : Date.now(),
            bucket: "praise",
            note: "",
            replyRowId:
              typeof row.replyRowId === "string" ? row.replyRowId : undefined,
          };
        })
        .filter(Boolean);
    }
    if (data && typeof data === "object" && Array.isArray(data.items)) {
      return data.items.map(normalizeItem).filter(Boolean);
    }
  } catch (e) {
    console.warn("loadFavorites", e);
  }
  return [];
}

/** 持久化 */
function saveFavorites(items) {
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify({ v: 2, items }));
  } catch (e) {
    console.warn("saveFavorites", e);
  }
}

/** 评价类型 → 收藏分区 */
function ratingTypeToBucket(ratingType) {
  if (ratingType === "中评") return "neutral";
  if (ratingType === "差评") return "negative";
  return "praise";
}

const BUCKET_LABELS = {
  praise: "好评",
  neutral: "中评",
  negative: "差评",
};

module.exports = {
  createId,
  loadFavorites,
  saveFavorites,
  ratingTypeToBucket,
  BUCKET_LABELS,
};
