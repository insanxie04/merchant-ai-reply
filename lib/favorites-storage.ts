/** 收藏分区：好评 / 中评 / 差评 */
export type FavoriteBucket = "praise" | "neutral" | "negative";

export const FAVORITE_BUCKETS: FavoriteBucket[] = [
  "praise",
  "neutral",
  "negative",
];

export const DEFAULT_BUCKET_LABELS: Record<FavoriteBucket, string> = {
  praise: "好评",
  neutral: "中评",
  negative: "差评",
};

export type FavoriteItem = {
  id: string;
  text: string;
  savedAt: number;
  bucket: FavoriteBucket;
  note: string;
};

export const FAVORITES_STORAGE_KEY = "dianping-xiaobang-favorites-v2";

/** 兼容 HTTP 等非安全上下文下 crypto.randomUUID 不可用 */
export function createFavoriteId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ratingTypeToBucket(
  ratingType: string
): FavoriteBucket {
  if (ratingType === "中评") return "neutral";
  if (ratingType === "差评") return "negative";
  return "praise";
}

function isBucket(s: string): s is FavoriteBucket {
  return s === "praise" || s === "neutral" || s === "negative";
}

function normalizeItem(row: unknown): FavoriteItem | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.text !== "string") return null;
  const savedAt =
    typeof r.savedAt === "number" && Number.isFinite(r.savedAt)
      ? r.savedAt
      : Date.now();
  const bucket =
    typeof r.bucket === "string" && isBucket(r.bucket)
      ? r.bucket
      : "praise";
  const note = typeof r.note === "string" ? r.note : "";
  return { id: r.id, text: r.text, savedAt, bucket, note };
}

export type ParsedFavoritesState = {
  items: FavoriteItem[];
};

export function parseFavoritesJson(raw: string | null): ParsedFavoritesState {
  if (!raw) return { items: [] };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { items: [] };
  }

  if (Array.isArray(data)) {
    const items: FavoriteItem[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.text !== "string") continue;
      items.push({
        id: r.id,
        text: r.text,
        savedAt:
          typeof r.savedAt === "number" ? r.savedAt : Date.now(),
        bucket: "praise",
        note: "",
      });
    }
    return { items };
  }

  if (data && typeof data === "object" && "items" in data) {
    const o = data as { items?: unknown };
    const items: FavoriteItem[] = [];
    if (Array.isArray(o.items)) {
      for (const row of o.items) {
        const it = normalizeItem(row);
        if (it) items.push(it);
      }
    }
    return { items };
  }

  return { items: [] };
}

export function serializeFavorites(items: FavoriteItem[]): string {
  return JSON.stringify({ v: 2, items });
}
