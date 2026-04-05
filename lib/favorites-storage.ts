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

/**
 * 参谋模式收藏扩展（字段名沿用 v2 以兼容历史数据：
 * problemAnalysis=核心分析，solutionBias=所选「回复方案倾向」全文）
 */
export type FavoriteAdvisorMeta = {
  problemAnalysis: string;
  solutionBias: string;
  extraInfo: string;
};

/** 首次生成时参数快照（用于跟进追评沿用） */
export type FavoriteGenerationParams = {
  category: string;
  style: string;
  lengthPreference: string;
  customPersona?: string;
};

export type FavoriteFollowUpReplyRow = {
  id: string;
  text: string;
};

/** 单条跟进记录 */
export type FavoriteFollowUpRecord = {
  id: string;
  buyerFollowUp: string;
  replyRows: FavoriteFollowUpReplyRow[];
  usedAdvisor: boolean;
  problemAnalysis?: string;
  /** 所选回复方案倾向全文（键名沿用 solutionBias 兼容旧数据） */
  solutionBias?: string;
  extraInfo?: string;
  createdAt: number;
  /**
   * 已采用单条展示时，为被采用条目的 reply row id；未设置则展示全部三条。
   * 兼容旧字段 isSelected、adoptedReplyRowId（string，同义）。
   */
  isAdopted?: string;
};

export type FavoriteItem = {
  id: string;
  /** 生成的商家回复文案 */
  text: string;
  savedAt: number;
  bucket: FavoriteBucket;
  note: string;
  /** 对应当前生成结果卡片行 id，避免同文多条收藏状态错乱 */
  replyRowId?: string;
  /** 收藏时的顾客原评论（评价原文），与 text 成对 */
  sourceReview?: string;
  /** 参谋模式：核心分析、回复方案倾向、补充信息（JSON 键名仍为 solutionBias） */
  advisorMeta?: FavoriteAdvisorMeta;
  /** 首次生成参数，旧数据可能缺失 */
  generationParams?: FavoriteGenerationParams;
  /** 评价跟进记录，按时间追加 */
  followUps?: FavoriteFollowUpRecord[];
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

function parseAdvisorMeta(raw: unknown): FavoriteAdvisorMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (typeof m.problemAnalysis !== "string" || typeof m.solutionBias !== "string")
    return undefined;
  const extraInfo = typeof m.extraInfo === "string" ? m.extraInfo : "";
  return {
    problemAnalysis: m.problemAnalysis,
    solutionBias: m.solutionBias,
    extraInfo,
  };
}

function parseGenerationParams(
  raw: unknown
): FavoriteGenerationParams | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const g = raw as Record<string, unknown>;
  if (typeof g.category !== "string" || typeof g.style !== "string") return undefined;
  const lengthPreference =
    typeof g.lengthPreference === "string" ? g.lengthPreference : "medium";
  const customPersona =
    typeof g.customPersona === "string" ? g.customPersona : undefined;
  return {
    category: g.category,
    style: g.style,
    lengthPreference,
    ...(customPersona ? { customPersona } : {}),
  };
}

function parseFollowUps(raw: unknown): FavoriteFollowUpRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FavoriteFollowUpRecord[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.buyerFollowUp !== "string") continue;
    const rows = r.replyRows;
    if (!Array.isArray(rows)) continue;
    const replyRows: FavoriteFollowUpReplyRow[] = [];
    for (const x of rows) {
      if (typeof x !== "object" || x === null) continue;
      const rx = x as Record<string, unknown>;
      if (typeof rx.id !== "string" || typeof rx.text !== "string") continue;
      replyRows.push({ id: rx.id, text: rx.text });
    }
    if (replyRows.length !== 3) continue;
    const adoptedRaw =
      typeof r.isAdopted === "string"
        ? r.isAdopted.trim()
        : typeof r.adoptedReplyRowId === "string"
          ? r.adoptedReplyRowId.trim()
          : typeof r.isSelected === "string"
            ? r.isSelected.trim()
            : "";
    const adoptedRowIdVal =
      adoptedRaw && replyRows.some((row) => row.id === adoptedRaw)
        ? adoptedRaw
        : undefined;
    out.push({
      id: r.id,
      buyerFollowUp: r.buyerFollowUp,
      replyRows,
      usedAdvisor: r.usedAdvisor === true,
      problemAnalysis:
        typeof r.problemAnalysis === "string" ? r.problemAnalysis : undefined,
      solutionBias:
        typeof r.solutionBias === "string" ? r.solutionBias : undefined,
      extraInfo: typeof r.extraInfo === "string" ? r.extraInfo : undefined,
      createdAt:
        typeof r.createdAt === "number" && Number.isFinite(r.createdAt)
          ? r.createdAt
          : Date.now(),
      ...(adoptedRowIdVal ? { isAdopted: adoptedRowIdVal } : {}),
    });
  }
  return out.length ? out : undefined;
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
  const replyRowId =
    typeof r.replyRowId === "string" ? r.replyRowId : undefined;
  const sourceReview =
    typeof r.sourceReview === "string" ? r.sourceReview : undefined;
  const advisorMeta = parseAdvisorMeta(r.advisorMeta);
  const generationParams = parseGenerationParams(r.generationParams);
  const followUps = parseFollowUps(r.followUps);
  return {
    id: r.id,
    text: r.text,
    savedAt,
    bucket,
    note,
    replyRowId,
    sourceReview,
    ...(advisorMeta ? { advisorMeta } : {}),
    ...(generationParams ? { generationParams } : {}),
    ...(followUps ? { followUps } : {}),
  };
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
        replyRowId:
          typeof r.replyRowId === "string" ? r.replyRowId : undefined,
        sourceReview:
          typeof r.sourceReview === "string" ? r.sourceReview : undefined,
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
