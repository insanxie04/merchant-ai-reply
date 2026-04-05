"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FavoriteItemFollowUps } from "@/components/favorite-item-follow-ups";
import { FavoriteFollowUpModal } from "@/components/favorite-follow-up-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EditablePresetSelect } from "@/components/ui/editable-preset-select";
import { GroupedCategorySelect } from "@/components/ui/grouped-category-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  followUpRowUiKey,
  parseFollowUpRowUiKey,
} from "@/lib/favorite-follow-up-ids";
import {
  createFavoriteId,
  DEFAULT_BUCKET_LABELS,
  FAVORITE_BUCKETS,
  FAVORITES_STORAGE_KEY,
  type FavoriteBucket,
  type FavoriteFollowUpRecord,
  type FavoriteItem,
  parseFavoritesJson,
  ratingTypeToBucket,
  serializeFavorites,
} from "@/lib/favorites-storage";
import { normalizeAdvisorCoreAnalysisDisplay } from "@/lib/bad-review-advisor";
import { trackEvent } from "@/lib/analytics";
import {
  EXTRACT_REVIEW_ACCEPT_IMAGES,
  EXTRACT_REVIEW_MAX_IMAGE_BYTES,
  requestExtractReviewFromImage,
} from "@/lib/extract-review-from-image-client";
import {
  LENGTH_PREFERENCE_OPTIONS,
  LENGTH_PREFERENCE_SELECT_ITEMS,
  type LengthPreferenceId,
} from "@/lib/length-preference";
import {
  PRESET_STYLE_LIST,
  type PresetStyle,
} from "@/lib/meituan-reply-prompt";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  HelpCircle,
  Copy,
  Loader2,
  MoreVertical,
  RefreshCw,
  Pencil,
  ScanText,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

const FAVORITES_LEGACY_KEY = "dianping-xiaobang-favorites-v1";

const FAVORITES_HELP_TEXT =
  "每条可写备注。数据保存在本地浏览器。点击「收藏」时会保存当时的评价原文与生成回复（成对），并按上方「评价类型」归入收藏夹对应分栏（好评 / 中评 / 差评）。";

type ReplyFeedback = "like" | "dislike";

const RATING_TYPES = ["好评", "中评", "差评"] as const;

type RatingType = (typeof RATING_TYPES)[number];

function advisorAnalysisSectionTitle(ratingType: RatingType): string {
  if (ratingType === "好评") return "📊 好评核心亮点分析";
  if (ratingType === "中评") return "📊 中评核心问题分析";
  return "📊 差评核心问题分析";
}

function favoriteBucketToRatingType(bucket: FavoriteBucket): RatingType {
  if (bucket === "neutral") return "中评";
  if (bucket === "negative") return "差评";
  return "好评";
}

function favoriteMatchesSidebarTab(
  f: FavoriteItem,
  tab: FavoriteBucket
): boolean {
  return f.bucket === tab;
}

function getLatestFollowUpId(item: FavoriteItem): string | null {
  const fus = item.followUps;
  if (!fus?.length) return null;
  return [...fus].sort((a, b) => b.createdAt - a.createdAt)[0]!.id;
}

const CATEGORY_OTHER_SENTINEL = "__category_other__";
const STYLE_CUSTOM_SENTINEL = "__style_custom_persona__";

type LoadingKind =
  | "idle"
  | "extract"
  | "generate"
  | "recognize_extract"
  | "recognize_generate"
  | "advisor_analyze"
  | "advisor_generate";

type AdvisorStep = "need_analysis" | "ready_final";

type ReplyRow = { id: string; text: string };

function replyRowsFromApiTexts(texts: string[]): ReplyRow[] {
  return texts.map((text) => ({
    id: createFavoriteId(),
    text,
  }));
}

async function requestGeneratedReplies(params: {
  review: string;
  category: string;
  style: PresetStyle;
  ratingType: RatingType;
  lengthPreference: LengthPreferenceId;
  customPersona?: string;
  extraRequirements?: string;
}): Promise<string[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }

  const body: Record<string, unknown> = {
    review: params.review,
    category: params.category,
    style: params.style,
    ratingType: params.ratingType,
    lengthPreference: params.lengthPreference,
  };
  const persona = params.customPersona?.trim();
  if (persona) body.customPersona = persona;
  const extra = params.extraRequirements?.trim();
  if (extra) body.extraRequirements = extra;

  let res: Response;
  try {
    res = await fetch("/api/generate-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("网络异常，请检查连接后重试。");
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("服务器返回了无法解析的数据，请稍后重试。");
  }

  const payload = data as { error?: string; replies?: unknown };

  if (!res.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `请求失败（${res.status}），请稍后重试。`
    );
  }

  if (
    !Array.isArray(payload.replies) ||
    payload.replies.length !== 3 ||
    !payload.replies.every((r) => typeof r === "string")
  ) {
    throw new Error("返回数据格式异常，请重试。");
  }

  return payload.replies as string[];
}

async function requestAdvisorCoreAnalysis(
  review: string,
  ratingType: RatingType
): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }
  let res: Response;
  try {
    res = await fetch("/api/advisor-core-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review, ratingType }),
    });
  } catch {
    throw new Error("网络异常，请检查连接后重试。");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("服务器返回了无法解析的数据，请稍后重试。");
  }
  const payload = data as { error?: string; analysis?: unknown };
  if (!res.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `请求失败（${res.status}），请稍后重试。`
    );
  }
  if (typeof payload.analysis !== "string" || !payload.analysis.trim()) {
    throw new Error("分析结果异常，请重试。");
  }
  return payload.analysis.trim();
}

async function requestAdvisorReplySchemes(
  review: string,
  ratingType: RatingType,
  coreAnalysis: string,
  opts?: {
    category: string;
    style: PresetStyle;
    lengthPreference: LengthPreferenceId;
    customPersona?: string;
    diversifyNonce?: string;
  }
): Promise<string[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }
  const body: Record<string, unknown> = { review, ratingType, coreAnalysis };
  if (opts) {
    body.category = opts.category;
    body.style = opts.style;
    body.lengthPreference = opts.lengthPreference;
    if (opts.customPersona) body.customPersona = opts.customPersona;
    if (opts.diversifyNonce) body.diversifyNonce = opts.diversifyNonce;
  }
  let res: Response;
  try {
    res = await fetch("/api/advisor-tendencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("网络异常，请检查连接后重试。");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("服务器返回了无法解析的数据，请稍后重试。");
  }
  const payload = data as { error?: string; tendencies?: unknown };
  if (!res.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `请求失败（${res.status}），请稍后重试。`
    );
  }
  if (
    !Array.isArray(payload.tendencies) ||
    payload.tendencies.length !== 3 ||
    !payload.tendencies.every((t) => typeof t === "string")
  ) {
    throw new Error("回复方案数据异常，请重试。");
  }
  return payload.tendencies as string[];
}

async function requestAdvisorFinalReplies(params: {
  ratingType: RatingType;
  review: string;
  problemAnalysis: string;
  solutionBias: string;
  userExtra: string;
  category: string;
  style: PresetStyle;
  lengthPreference: LengthPreferenceId;
  customPersona?: string;
}): Promise<string[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }
  const body: Record<string, unknown> = {
    ratingType: params.ratingType,
    review: params.review,
    problemAnalysis: params.problemAnalysis,
    solutionBias: params.solutionBias,
    userExtra: params.userExtra,
    category: params.category,
    style: params.style,
    lengthPreference: params.lengthPreference,
  };
  const persona = params.customPersona?.trim();
  if (persona) body.customPersona = persona;
  let res: Response;
  try {
    res = await fetch("/api/generate-replies-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("网络异常，请检查连接后重试。");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("服务器返回了无法解析的数据，请稍后重试。");
  }
  const payload = data as { error?: string; replies?: unknown };
  if (!res.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `请求失败（${res.status}），请稍后重试。`
    );
  }
  if (
    !Array.isArray(payload.replies) ||
    payload.replies.length !== 3 ||
    !payload.replies.every((r) => typeof r === "string")
  ) {
    throw new Error("返回数据格式异常，请重试。");
  }
  return payload.replies as string[];
}

function isStrongRatingConflict(
  selected: RatingType,
  inferred: RatingType
): boolean {
  return (
    (selected === "好评" && inferred === "差评") ||
    (selected === "差评" && inferred === "好评")
  );
}

async function requestClassifyRating(
  review: string
): Promise<RatingType | null> {
  const trimmed = review.trim();
  if (!trimmed) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return null;
  }
  let res: Response;
  try {
    res = await fetch("/api/classify-rating-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review: trimmed }),
    });
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const payload = data as { ratingType?: unknown };
  if (!res.ok) return null;
  const rt = payload.ratingType;
  if (rt !== "好评" && rt !== "中评" && rt !== "差评") return null;
  return rt;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const primaryGenerateButtonRef = useRef<HTMLButtonElement>(null);
  const ratingAutoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const dragDepthRef = useRef(0);
  const loadingRef = useRef(false);
  /** 生成流程含分类校验、冲突弹窗等待，在未进入 loading 前也需互斥 */
  const primaryGenerateBusyRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [review, setReview] = useState("");
  const [categorySelectValue, setCategorySelectValue] = useState("餐饮");
  const [categoryCustomText, setCategoryCustomText] = useState("");
  const [styleSelectValue, setStyleSelectValue] = useState("亲切热情");
  const [styleCustomText, setStyleCustomText] = useState("");
  const [ratingType, setRatingType] = useState<RatingType>("好评");
  /** 用户是否曾手动改过评价类型；为 true 时识别成功后的自动分类不覆盖 */
  const ratingTypeUserLockedRef = useRef(false);
  /** 「识别文字」成功后短时展示：已自动识别为 XX（约 3 秒） */
  const [ratingAutoHintType, setRatingAutoHintType] =
    useState<RatingType | null>(null);
  const [ratingConflict, setRatingConflict] = useState<null | {
    selected: RatingType;
    inferred: RatingType;
    resolve: (r: RatingType) => void;
  }>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState<LoadingKind>("idle");
  const [loadingHint, setLoadingHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replyRows, setReplyRows] = useState<ReplyRow[]>([]);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [replyEditDraft, setReplyEditDraft] = useState("");
  const [extraRequirements, setExtraRequirements] = useState("");
  const [lengthPreferenceId, setLengthPreferenceId] =
    useState<LengthPreferenceId>("medium");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [replyFeedback, setReplyFeedback] = useState<
    Partial<Record<number, ReplyFeedback>>
  >({});
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [favoritesPanelOpen, setFavoritesPanelOpen] = useState(false);
  const [favoriteTab, setFavoriteTab] = useState<FavoriteBucket>("neutral");
  /** 收藏夹内「顾客原评论」收起态：true 表示折叠为一行；默认展开（键不存在） */
  const [favSourceCollapsed, setFavSourceCollapsed] = useState<
    Record<string, boolean>
  >({});
  const [replyMoreMenuOpenId, setReplyMoreMenuOpenId] = useState<string | null>(
    null
  );
  const [favoritesHelpOpen, setFavoritesHelpOpen] = useState(false);

  /** 参谋模式（好评 / 中评 / 差评） */
  const [advisorModeEnabled, setAdvisorModeEnabled] = useState(false);
  const [advisorStep, setAdvisorStep] = useState<AdvisorStep>("need_analysis");
  const [advisorCoreAnalysis, setAdvisorCoreAnalysis] = useState("");
  const [advisorTendencyOptions, setAdvisorTendencyOptions] = useState<
    string[]
  >([]);
  const [advisorSelectedTendencyIndex, setAdvisorSelectedTendencyIndex] =
    useState<number | null>(null);
  const [advisorSupplement, setAdvisorSupplement] = useState("");
  /** 最近一次参谋模式最终生成成功后的快照，用于收藏写入 */
  const [advisorFavoriteSnapshot, setAdvisorFavoriteSnapshot] = useState<{
    problemAnalysis: string;
    solutionBias: string;
    extraInfo: string;
  } | null>(null);
  const favoritesListUlRef = useRef<HTMLUListElement>(null);
  const [followUpModal, setFollowUpModal] = useState<null | {
    favoriteId: string;
    branchFollowUpId: string | null;
  }>(null);
  const [editingFollowUpKey, setEditingFollowUpKey] = useState<string | null>(
    null
  );
  const [followUpEditDraft, setFollowUpEditDraft] = useState("");
  const [followUpRefreshingKey, setFollowUpRefreshingKey] = useState<
    string | null
  >(null);
  const [advisorTendenciesRefreshing, setAdvisorTendenciesRefreshing] =
    useState(false);
  const [resultsRefreshing, setResultsRefreshing] = useState(false);

  useEffect(() => {
    setAdvisorStep("need_analysis");
    setAdvisorCoreAnalysis("");
    setAdvisorTendencyOptions([]);
    setAdvisorSelectedTendencyIndex(null);
    setAdvisorSupplement("");
    setAdvisorFavoriteSnapshot(null);
  }, [ratingType]);

  useEffect(() => {
    trackEvent("page_view");
  }, []);

  useEffect(() => {
    if (!favoritesPanelOpen) return;
    const id = requestAnimationFrame(() => {
      const root = favoritesListUlRef.current;
      if (!root) return;
      const anchor = root.querySelector("[data-latest-follow-anchor]");
      anchor?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [favoritesPanelOpen, favoriteTab, favorites]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (ratingAutoHintTimerRef.current) {
        clearTimeout(ratingAutoHintTimerRef.current);
        ratingAutoHintTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!favoritesHelpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFavoritesHelpOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [favoritesHelpOpen]);

  useEffect(() => {
    if (!replyMoreMenuOpenId) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const root = (t as HTMLElement).closest(
        `[data-reply-more-root="${replyMoreMenuOpenId}"]`
      );
      if (!root) setReplyMoreMenuOpenId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReplyMoreMenuOpenId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [replyMoreMenuOpenId]);

  useEffect(() => {
    try {
      let raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem(FAVORITES_LEGACY_KEY);
      }
      const { items } = parseFavoritesJson(raw);
      setFavorites(items);
    } catch {
      /* ignore */
    }
    setFavoritesHydrated(true);
  }, []);

  useEffect(() => {
    if (!favoritesHydrated) return;
    try {
      localStorage.setItem(
        FAVORITES_STORAGE_KEY,
        serializeFavorites(favorites)
      );
    } catch {
      /* ignore */
    }
  }, [favorites, favoritesHydrated]);

  loadingRef.current = loading;

  const clearRatingAutoHint = useCallback(() => {
    if (ratingAutoHintTimerRef.current) {
      clearTimeout(ratingAutoHintTimerRef.current);
      ratingAutoHintTimerRef.current = null;
    }
    setRatingAutoHintType(null);
  }, []);

  const scheduleAutoRatingHint = useCallback(
    (inferred: RatingType) => {
      clearRatingAutoHint();
      setRatingAutoHintType(inferred);
      ratingAutoHintTimerRef.current = setTimeout(() => {
        setRatingAutoHintType(null);
        ratingAutoHintTimerRef.current = null;
      }, 3000);
      trackEvent("auto_recognize", { ratingType: inferred });
      requestAnimationFrame(() => {
        primaryGenerateButtonRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    },
    [clearRatingAutoHint]
  );

  const clearReplyEditing = useCallback(() => {
    setEditingReplyId(null);
    setReplyEditDraft("");
    setReplyMoreMenuOpenId(null);
    setEditingFollowUpKey(null);
    setFollowUpEditDraft("");
  }, []);

  const getEffectiveCategory = useCallback((): string => {
    if (categorySelectValue === CATEGORY_OTHER_SENTINEL) {
      return categoryCustomText.trim();
    }
    return categorySelectValue;
  }, [categorySelectValue, categoryCustomText]);

  const getEffectiveCustomPersona = useCallback((): string | undefined => {
    if (styleSelectValue !== STYLE_CUSTOM_SENTINEL) return undefined;
    const t = styleCustomText.trim();
    return t || undefined;
  }, [styleSelectValue, styleCustomText]);

  const getApiStyle = useCallback((): PresetStyle => {
    if (getEffectiveCustomPersona()) return "亲切热情";
    if (styleSelectValue === STYLE_CUSTOM_SENTINEL) return "亲切热情";
    return styleSelectValue as PresetStyle;
  }, [styleSelectValue, getEffectiveCustomPersona]);

  const clearSelectedImage = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSelectedImageFile((prev) => {
      if (prev) trackEvent("delete");
      return null;
    });
  }, []);

  const assignImageFile = useCallback(
    (file: File): boolean => {
      const allowed = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ]);
      if (!allowed.has(file.type)) {
        toast.error("请上传 JPG、PNG、WebP 或 GIF 格式的截图");
        return false;
      }
      if (file.size > EXTRACT_REVIEW_MAX_IMAGE_BYTES) {
        toast.error(
          `图片需小于 ${EXTRACT_REVIEW_MAX_IMAGE_BYTES / (1024 * 1024)}MB，请先压缩或裁剪`
        );
        return false;
      }
      setImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setSelectedImageFile(file);
      trackEvent("upload");
      return true;
    },
    []
  );

  const runExtractWithFile = useCallback(
    async (
      file: File,
      opts?: { clearImageAfterSuccess?: boolean; trackOcr?: boolean }
    ): Promise<string | null> => {
      if (loadingRef.current) return null;
      const clearImageAfterSuccess = opts?.clearImageAfterSuccess ?? true;
      const trackOcr = Boolean(opts?.trackOcr);
      if (trackOcr) trackEvent("ocr_click");
      setError(null);
      setReplyRows([]);
      clearReplyEditing();
      setReplyFeedback({});
      setLoading(true);
      setLoadingKind("extract");
      setLoadingHint("正在识别截图中的评价文字…");

      try {
        const text = await requestExtractReviewFromImage(file);
        setReview(text);
        setReviewError(null);
        if (clearImageAfterSuccess) {
          clearSelectedImage();
        }
        if (trackOcr) trackEvent("ocr_suc");
        toast.success("识别成功");
        return text;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "识图失败，请稍后重试。";
        setError(message);
        toast.error(message);
        if (trackOcr) trackEvent("ocr_fail");
        return null;
      } finally {
        setLoading(false);
        setLoadingKind("idle");
        setLoadingHint("");
      }
    },
    [clearSelectedImage, clearReplyEditing]
  );

  const waitIfStrongRatingConflict = useCallback(
    (selected: RatingType, inferred: RatingType | null): Promise<RatingType> => {
      if (!inferred || !isStrongRatingConflict(selected, inferred)) {
        return Promise.resolve(selected);
      }
      return new Promise<RatingType>((resolve) => {
        setRatingConflict({ selected, inferred, resolve });
      });
    },
    []
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (loadingRef.current) return;
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        if (assignImageFile(file)) {
          void runExtractWithFile(file, { trackOcr: true });
        }
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [assignImageFile, runExtractWithFile]);

  const onPickImageClick = () => fileInputRef.current?.click();

  const onUploadDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types?.includes("Files")) setIsDragOver(true);
  };

  const onUploadDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    }
  };

  const onUploadDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const onUploadDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    assignImageFile(file);
  };

  const onImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    assignImageFile(file);
  };

  const handleExtractOnly = async () => {
    if (!selectedImageFile) {
      toast.error("请先选择评价截图");
      return;
    }
    const text = await runExtractWithFile(selectedImageFile, {
      trackOcr: true,
    });
    if (!text) return;
    if (ratingTypeUserLockedRef.current) return;
    const inferred = await requestClassifyRating(text);
    if (!inferred) return;
    if (ratingTypeUserLockedRef.current) return;
    setRatingType(inferred);
    scheduleAutoRatingHint(inferred);
  };

  const executeGenerateAfterReviewReady = useCallback(
    async (reviewText: string, finalRating: RatingType) => {
      const cat = getEffectiveCategory();
      if (!cat) {
        throw new Error("请选择或输入商家品类");
      }
      const genPayload = (text: string, rt: RatingType) => {
        const customPersona = getEffectiveCustomPersona();
        const ex = extraRequirements.trim();
        return {
          review: text,
          category: cat,
          style: getApiStyle(),
          ratingType: rt,
          lengthPreference: lengthPreferenceId,
          ...(customPersona ? { customPersona } : {}),
          ...(ex ? { extraRequirements: ex } : {}),
        };
      };

      if (advisorModeEnabled) {
        if (advisorStep === "need_analysis") {
          const analysis = await requestAdvisorCoreAnalysis(
            reviewText,
            finalRating
          );
          const personaForSchemes = getEffectiveCustomPersona();
          const schemes = await requestAdvisorReplySchemes(
            reviewText,
            finalRating,
            analysis,
            {
              category: cat,
              style: getApiStyle(),
              lengthPreference: lengthPreferenceId,
              ...(personaForSchemes
                ? { customPersona: personaForSchemes }
                : {}),
            }
          );
          setAdvisorCoreAnalysis(analysis);
          setAdvisorTendencyOptions(schemes);
          setAdvisorSelectedTendencyIndex(null);
          setAdvisorStep("ready_final");
          trackEvent("gen_suc");
          toast.success("核心分析与回复方案生成成功");
          return;
        }
        const analysisText = advisorCoreAnalysis.trim();
        if (!analysisText) {
          throw new Error("请先完成参谋分析");
        }
        if (
          advisorSelectedTendencyIndex === null ||
          !advisorTendencyOptions[advisorSelectedTendencyIndex]
        ) {
          throw new Error("请先选择回复方案倾向");
        }
        const selectedTendency =
          advisorTendencyOptions[advisorSelectedTendencyIndex]!;
        const persona = getEffectiveCustomPersona();
        const next = await requestAdvisorFinalReplies({
          ratingType: finalRating,
          review: reviewText,
          problemAnalysis: analysisText,
          solutionBias: selectedTendency,
          userExtra: advisorSupplement.trim(),
          category: cat,
          style: getApiStyle(),
          lengthPreference: lengthPreferenceId,
          ...(persona ? { customPersona: persona } : {}),
        });
        clearReplyEditing();
        setReplyRows(replyRowsFromApiTexts(next));
        setAdvisorFavoriteSnapshot({
          problemAnalysis: analysisText,
          solutionBias: selectedTendency,
          extraInfo: advisorSupplement.trim(),
        });
        trackEvent("gen_suc");
        toast.success("最终回复生成成功");
        setTimeout(() => {
          resultsHeadingRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 150);
        return;
      }

      setAdvisorFavoriteSnapshot(null);
      if (extraRequirements.trim()) trackEvent("append_req_used");
      const next = await requestGeneratedReplies(
        genPayload(reviewText, finalRating)
      );
      clearReplyEditing();
      setReplyRows(replyRowsFromApiTexts(next));
      trackEvent("gen_suc");
      toast.success("生成成功");
      setTimeout(() => {
        resultsHeadingRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 150);
    },
    [
      advisorModeEnabled,
      advisorStep,
      advisorCoreAnalysis,
      advisorTendencyOptions,
      advisorSelectedTendencyIndex,
      advisorSupplement,
      lengthPreferenceId,
      extraRequirements,
      getEffectiveCategory,
      getApiStyle,
      getEffectiveCustomPersona,
      clearReplyEditing,
    ]
  );

  const refreshAdvisorTendencies = useCallback(async () => {
    if (!advisorModeEnabled || advisorStep !== "ready_final") return;
    const reviewText = review.trim();
    const analysisText = advisorCoreAnalysis.trim();
    if (!reviewText || !analysisText) {
      toast.error("请先完成核心分析");
      return;
    }
    const cat = getEffectiveCategory();
    if (!cat) {
      toast.error("请选择或输入商家品类");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("当前网络不可用，请连接网络后重试。");
      return;
    }
    const dismiss = toast.loading("正在换一批回复方案…");
    setAdvisorTendenciesRefreshing(true);
    setAdvisorSelectedTendencyIndex(null);
    try {
      const persona = getEffectiveCustomPersona();
      const schemes = await requestAdvisorReplySchemes(
        reviewText,
        ratingType,
        analysisText,
        {
          category: cat,
          style: getApiStyle(),
          lengthPreference: lengthPreferenceId,
          ...(persona ? { customPersona: persona } : {}),
          diversifyNonce: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        }
      );
      setAdvisorTendencyOptions(schemes);
      toast.success("已换一批回复方案", { id: dismiss });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "换一批失败，请稍后重试。";
      toast.error(msg, { id: dismiss });
    } finally {
      setAdvisorTendenciesRefreshing(false);
    }
  }, [
    advisorModeEnabled,
    advisorStep,
    review,
    advisorCoreAnalysis,
    ratingType,
    lengthPreferenceId,
    getEffectiveCategory,
    getEffectiveCustomPersona,
    getApiStyle,
  ]);

  const refreshGeneratedResults = useCallback(async () => {
    if (loading || resultsRefreshing) return;
    const reviewText = review.trim();
    if (!reviewText) {
      toast.error("请先在上方输入或识别评价内容");
      return;
    }
    if (replyRows.length === 0) {
      toast.error("请先生成回复");
      return;
    }
    const cat = getEffectiveCategory();
    if (!cat) {
      toast.error("请选择或输入商家品类");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("当前网络不可用，请连接网络后重试。");
      return;
    }
    const dismiss = toast.loading("正在换一批回复…");
    setResultsRefreshing(true);
    try {
      const finalRating = ratingType;
      const useAdvisorFinal =
        advisorModeEnabled &&
        advisorStep === "ready_final" &&
        advisorSelectedTendencyIndex !== null &&
        Boolean(
          advisorTendencyOptions[advisorSelectedTendencyIndex!]
        );

      if (useAdvisorFinal) {
        const analysisText = advisorCoreAnalysis.trim();
        if (!analysisText) {
          throw new Error("请先完成参谋分析");
        }
        const selectedTendency =
          advisorTendencyOptions[advisorSelectedTendencyIndex!]!;
        const persona = getEffectiveCustomPersona();
        const next = await requestAdvisorFinalReplies({
          ratingType: finalRating,
          review: reviewText,
          problemAnalysis: analysisText,
          solutionBias: selectedTendency,
          userExtra: advisorSupplement.trim(),
          category: cat,
          style: getApiStyle(),
          lengthPreference: lengthPreferenceId,
          ...(persona ? { customPersona: persona } : {}),
        });
        clearReplyEditing();
        setReplyRows(replyRowsFromApiTexts(next));
        setReplyFeedback({});
        setAdvisorFavoriteSnapshot({
          problemAnalysis: analysisText,
          solutionBias: selectedTendency,
          extraInfo: advisorSupplement.trim(),
        });
      } else {
        const customPersona = getEffectiveCustomPersona();
        const ex = extraRequirements.trim();
        const next = await requestGeneratedReplies({
          review: reviewText,
          category: cat,
          style: getApiStyle(),
          ratingType: finalRating,
          lengthPreference: lengthPreferenceId,
          ...(customPersona ? { customPersona } : {}),
          ...(ex ? { extraRequirements: ex } : {}),
        });
        clearReplyEditing();
        setReplyRows(replyRowsFromApiTexts(next));
        setReplyFeedback({});
        setAdvisorFavoriteSnapshot(null);
      }
      trackEvent("gen_suc");
      toast.success("已换一批回复", { id: dismiss });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "换一批失败，请稍后重试。";
      toast.error(msg, { id: dismiss });
    } finally {
      setResultsRefreshing(false);
    }
  }, [
    loading,
    resultsRefreshing,
    review,
    replyRows.length,
    getEffectiveCategory,
    advisorModeEnabled,
    advisorStep,
    advisorSelectedTendencyIndex,
    advisorTendencyOptions,
    advisorCoreAnalysis,
    advisorSupplement,
    ratingType,
    lengthPreferenceId,
    extraRequirements,
    getApiStyle,
    getEffectiveCustomPersona,
    clearReplyEditing,
  ]);

  const handlePrimaryGenerate = async () => {
    if (loadingRef.current) return;
    if (primaryGenerateBusyRef.current) return;
    primaryGenerateBusyRef.current = true;
    try {
    const trimmed = review.trim();
    const hasFile = Boolean(selectedImageFile);
    if (!hasFile && !trimmed) {
      toast.error("请先上传截图或输入评价内容");
      return;
    }
    const cat = getEffectiveCategory();
    if (!cat) {
      toast.error("请选择或输入商家品类");
      return;
    }

    trackEvent("gen_click");

    if (hasFile && !trimmed) {
      setReviewError(null);
      setError(null);
      setReplyRows([]);
      clearReplyEditing();
      setReplyFeedback({});
      setLoading(true);
      setLoadingKind("recognize_extract");
      setLoadingHint("正在识别截图中的评价文字…");
      let phase: "extract" | "generate" = "extract";
      let genPhase: "normal" | "advisor_analyze" | "advisor_final" =
        "normal";
      try {
        trackEvent("ocr_click");
        const text = await requestExtractReviewFromImage(selectedImageFile!);
        trackEvent("ocr_suc");
        setReview(text);
        setLoading(false);
        setLoadingKind("idle");
        setLoadingHint("");
        const inferred = await requestClassifyRating(text);
        let rt: RatingType = ratingType;
        if (!ratingTypeUserLockedRef.current && inferred) {
          rt = inferred;
          setRatingType(inferred);
          scheduleAutoRatingHint(inferred);
        }
        const finalRating = await waitIfStrongRatingConflict(rt, inferred);
        const useAdv = advisorModeEnabled;
        if (useAdv && advisorStep === "need_analysis") {
          genPhase = "advisor_analyze";
        } else if (useAdv && advisorStep === "ready_final") {
          genPhase = "advisor_final";
        }
        setLoading(true);
        if (genPhase === "advisor_analyze") {
          setLoadingKind("advisor_analyze");
          setLoadingHint("正在生成核心分析与回复方案…");
        } else if (genPhase === "advisor_final") {
          setLoadingKind("advisor_generate");
          setLoadingHint("正在生成最终回复…");
        } else {
          setLoadingKind("recognize_generate");
          setLoadingHint("正在生成回复…");
        }
        phase = "generate";
        await executeGenerateAfterReviewReady(text, finalRating);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "处理失败，请稍后重试。";
        setError(message);
        if (phase === "extract") trackEvent("ocr_fail");
        trackEvent("gen_fail");
        toast.error(
          phase === "extract"
            ? "识别失败，请重试"
            : genPhase === "advisor_analyze"
              ? "分析生成失败，请重试"
              : genPhase === "advisor_final"
                ? "最终回复生成失败，请重试"
                : "生成失败，请重试"
        );
      } finally {
        setLoading(false);
        setLoadingKind("idle");
        setLoadingHint("");
      }
      return;
    }

    if (!trimmed) {
      setReviewError("请粘贴或输入评价内容");
      toast.error("请填写评价原文");
      trackEvent("gen_fail");
      return;
    }
    setReviewError(null);
    setError(null);
    setReplyRows([]);
    clearReplyEditing();
    setReplyFeedback({});

    const inferredText = await requestClassifyRating(trimmed);
    const finalRating = await waitIfStrongRatingConflict(
      ratingType,
      inferredText
    );

    const useAdvText = advisorModeEnabled;
    let genPhaseText: "normal" | "advisor_analyze" | "advisor_final" =
      "normal";
    if (useAdvText && advisorStep === "need_analysis") {
      genPhaseText = "advisor_analyze";
    } else if (useAdvText && advisorStep === "ready_final") {
      genPhaseText = "advisor_final";
    }

    setLoading(true);
    if (genPhaseText === "advisor_analyze") {
      setLoadingKind("advisor_analyze");
      setLoadingHint("正在生成核心分析与回复方案…");
    } else if (genPhaseText === "advisor_final") {
      setLoadingKind("advisor_generate");
      setLoadingHint("正在生成最终回复…");
    } else {
      setLoadingKind("generate");
      setLoadingHint("正在生成回复…");
    }

    try {
      await executeGenerateAfterReviewReady(trimmed, finalRating);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "生成失败，请稍后重试。";
      setError(message);
      trackEvent("gen_fail");
      toast.error(
        genPhaseText === "advisor_analyze"
          ? "分析生成失败，请重试"
          : genPhaseText === "advisor_final"
            ? "最终回复生成失败，请重试"
            : "生成失败，请重试"
      );
    } finally {
      setLoading(false);
      setLoadingKind("idle");
      setLoadingHint("");
    }
    } finally {
      primaryGenerateBusyRef.current = false;
    }
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      trackEvent("copy_click", { scope: "result", index });
      toast.success(`回复 ${index + 1} 已复制到剪贴板`);
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  const handleCopyFavorite = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      trackEvent("copy_click", { scope: "favorite" });
      toast.success("已复制收藏内容");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  const getDefaultGenerationParams = useCallback(() => {
    const persona = getEffectiveCustomPersona();
    return {
      category: getEffectiveCategory(),
      style: getApiStyle(),
      lengthPreference: lengthPreferenceId,
      ...(persona ? { customPersona: persona } : {}),
    };
  }, [
    getEffectiveCategory,
    getApiStyle,
    lengthPreferenceId,
    getEffectiveCustomPersona,
  ]);

  const resolveFavoriteGenerationParams = useCallback(
    (favItem: FavoriteItem) =>
      favItem.generationParams ?? getDefaultGenerationParams(),
    [getDefaultGenerationParams]
  );

  const getLastMerchantReplyForFollowUp = useCallback(
    (favItem: FavoriteItem, branchFollowUpId: string | null) => {
      if (!branchFollowUpId) return favItem.text;
      const fu = favItem.followUps?.find((x) => x.id === branchFollowUpId);
      if (!fu) return favItem.text;
      return fu.replyRows.map((r) => r.text).join("\n\n—\n\n");
    },
    []
  );

  /** 当前跟进条目的「上一轮」跟进 id，用于拼接商家上次回复 */
  const getParentBranchFollowUpId = useCallback(
    (favItem: FavoriteItem, fu: FavoriteFollowUpRecord) => {
      const sorted = [...(favItem.followUps ?? [])].sort(
        (a, b) => a.createdAt - b.createdAt
      );
      const i = sorted.findIndex((x) => x.id === fu.id);
      if (i <= 0) return null;
      return sorted[i - 1]!.id;
    },
    []
  );

  const followUpOrdinalMap = useCallback((list: FavoriteFollowUpRecord[]) => {
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    const m = new Map<string, number>();
    sorted.forEach((fu, i) => m.set(fu.id, i + 1));
    return m;
  }, []);

  const formatFollowUpDate = (ts: number) =>
    new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

  const appendFollowUpToFavorite = (
    favoriteId: string,
    record: FavoriteFollowUpRecord
  ) => {
    setFavorites((p) =>
      p.map((f) =>
        f.id !== favoriteId
          ? f
          : { ...f, followUps: [...(f.followUps ?? []), record] }
      )
    );
  };

  const beginReplyEdit = (rowId: string, text: string) => {
    setEditingFollowUpKey(null);
    setFollowUpEditDraft("");
    setReplyMoreMenuOpenId(null);
    setEditingReplyId(rowId);
    setReplyEditDraft(text);
  };

  const saveReplyEdit = () => {
    if (editingFollowUpKey) {
      const parsed = parseFollowUpRowUiKey(editingFollowUpKey);
      if (!parsed) return;
      const text = followUpEditDraft;
      setFavorites((favs) =>
        favs.map((f) => {
          if (f.id !== parsed.favoriteId) return f;
          const nextFus = f.followUps?.map((fu) =>
            fu.id !== parsed.followUpId
              ? fu
              : {
                  ...fu,
                  replyRows: fu.replyRows.map((r) =>
                    r.id === parsed.rowId ? { ...r, text } : r
                  ),
                }
          );
          return { ...f, followUps: nextFus };
        })
      );
      setEditingFollowUpKey(null);
      setFollowUpEditDraft("");
      trackEvent("edit_reply");
      toast.success("保存成功");
      return;
    }
    if (!editingReplyId) return;
    const id = editingReplyId;
    const text = replyEditDraft;
    setReplyRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, text } : r))
    );
    setFavorites((favs) =>
      favs.map((f) => (f.replyRowId === id ? { ...f, text } : f))
    );
    clearReplyEditing();
    trackEvent("edit_reply");
    toast.success("保存成功");
  };

  const handleReplyFeedback = (index: number, kind: ReplyFeedback) => {
    const cur = replyFeedback[index];
    if (cur === kind) {
      setReplyFeedback((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      trackEvent(kind === "like" ? "like" : "dislike", {
        index,
        action: "remove",
      });
      toast.message("已取消该条反馈");
      return;
    }
    setReplyFeedback((prev) => ({ ...prev, [index]: kind }));
    trackEvent(kind === "like" ? "like" : "dislike", {
      index,
      action: "add",
    });
    toast.success(
      kind === "like"
        ? "感谢点赞，已记录反馈"
        : "已记录反馈，我们会持续改进"
    );
  };

  const beginFollowUpEdit = (
    favoriteId: string,
    followUpId: string,
    rowId: string,
    text: string
  ) => {
    setReplyMoreMenuOpenId(null);
    setEditingReplyId(null);
    setReplyEditDraft("");
    setEditingFollowUpKey(followUpRowUiKey(favoriteId, followUpId, rowId));
    setFollowUpEditDraft(text);
  };

  const toggleFollowUpAdopt = useCallback(
    (favoriteId: string, followUpId: string, rowId: string) => {
      const fav = favorites.find((f) => f.id === favoriteId);
      const fu = fav?.followUps?.find((x) => x.id === followUpId);
      const clearing = fu?.isAdopted === rowId;

      const parsedKey = editingFollowUpKey
        ? parseFollowUpRowUiKey(editingFollowUpKey)
        : null;
      if (
        parsedKey?.favoriteId === favoriteId &&
        parsedKey.followUpId === followUpId &&
        !clearing &&
        parsedKey.rowId !== rowId
      ) {
        setEditingFollowUpKey(null);
        setFollowUpEditDraft("");
      }

      setFavorites((p) =>
        p.map((f) => {
          if (f.id !== favoriteId) return f;
          return {
            ...f,
            followUps: f.followUps?.map((x) => {
              if (x.id !== followUpId) return x;
              if (clearing) {
                return { ...x, isAdopted: undefined };
              }
              return { ...x, isAdopted: rowId };
            }),
          };
        })
      );
      toast.success(
        clearing ? "已展开全部跟进回复" : "已采用该回复"
      );
    },
    [favorites, editingFollowUpKey]
  );

  const refreshFollowUpBatch = useCallback(
    async (favoriteId: string, followUpId: string) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        toast.error("当前网络不可用，请连接网络后重试。");
        return;
      }
      const item = favorites.find((f) => f.id === favoriteId);
      const fu = item?.followUps?.find((x) => x.id === followUpId);
      if (!item || !fu) return;

      const refreshKey = `${favoriteId}::${followUpId}`;
      setFollowUpRefreshingKey(refreshKey);

      const originalReview = (item.sourceReview ?? "").trim();
      const branch = getParentBranchFollowUpId(item, fu);
      const lastMerchantReply = getLastMerchantReplyForFollowUp(item, branch);
      const gp = resolveFavoriteGenerationParams(item);
      const style = gp.style as PresetStyle;
      const persona = gp.customPersona?.trim();

      const baseBody: Record<string, unknown> = {
        originalReview,
        lastMerchantReply,
        buyerFollowUp: fu.buyerFollowUp.trim(),
        category: gp.category,
        style,
        lengthPreference: gp.lengthPreference,
      };
      if (persona) baseBody.customPersona = persona;

      try {
        let res: Response;
        if (fu.usedAdvisor) {
          const pa = fu.problemAnalysis?.trim();
          const sb = fu.solutionBias?.trim();
          if (!pa || !sb) {
            toast.error("参谋跟进记录不完整，无法换一批");
            return;
          }
          res = await fetch("/api/generate-replies-advisor-follow-up", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...baseBody,
              ratingType: favoriteBucketToRatingType(item.bucket),
              problemAnalysis: pa,
              solutionBias: sb,
              userExtra: fu.extraInfo?.trim() ?? "",
            }),
          });
        } else {
          res = await fetch("/api/generate-follow-up-replies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(baseBody),
          });
        }

        let data: unknown;
        try {
          data = await res.json();
        } catch {
          throw new Error("服务器返回了无法解析的数据，请稍后重试。");
        }
        const payload = data as { error?: string; replies?: unknown };
        if (!res.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : `请求失败（${res.status}），请稍后重试。`
          );
        }
        if (
          !Array.isArray(payload.replies) ||
          payload.replies.length !== 3 ||
          !payload.replies.every((r) => typeof r === "string")
        ) {
          throw new Error("返回数据格式异常，请重试。");
        }
        const texts = payload.replies as string[];

        setFavorites((p) =>
          p.map((f) => {
            if (f.id !== favoriteId) return f;
            return {
              ...f,
              followUps: f.followUps?.map((x) =>
                x.id !== followUpId
                  ? x
                  : {
                      ...x,
                      replyRows: texts.map((text) => ({
                        id: createFavoriteId(),
                        text,
                      })),
                      isAdopted: undefined,
                    }
              ),
            };
          })
        );
        setEditingFollowUpKey((cur) => {
          const parsed = cur ? parseFollowUpRowUiKey(cur) : null;
          if (
            parsed?.favoriteId === favoriteId &&
            parsed.followUpId === followUpId
          ) {
            return null;
          }
          return cur;
        });
        setFollowUpEditDraft("");
        toast.success("换一批生成成功");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "换一批失败，请稍后重试。";
        toast.error(msg);
      } finally {
        setFollowUpRefreshingKey(null);
      }
    },
    [
      favorites,
      getLastMerchantReplyForFollowUp,
      getParentBranchFollowUpId,
      resolveFavoriteGenerationParams,
    ]
  );

  const toggleFavorite = (
    replyRowId: string,
    replyText: string,
    sourceReviewSnapshot: string
  ) => {
    const existing = favorites.find((f) => f.replyRowId === replyRowId);
    if (existing) {
      setFavorites((p) => p.filter((f) => f.id !== existing.id));
      setFavSourceCollapsed((p) => {
        const next = { ...p };
        delete next[existing.id];
        return next;
      });
      trackEvent("collect_toggle", { collected: false });
      toast.success("已取消收藏");
      return;
    }
    const bucket = ratingTypeToBucket(ratingType);
    const src = sourceReviewSnapshot.trim();
    const newId = createFavoriteId();
    const advisorMeta = advisorFavoriteSnapshot
      ? {
          problemAnalysis: advisorFavoriteSnapshot.problemAnalysis,
          solutionBias: advisorFavoriteSnapshot.solutionBias,
          extraInfo: advisorFavoriteSnapshot.extraInfo,
        }
      : undefined;
    const genParams = getDefaultGenerationParams();
    setFavorites((p) => [
      ...p,
      {
        id: newId,
        text: replyText,
        replyRowId,
        savedAt: Date.now(),
        bucket,
        note: "",
        ...(src ? { sourceReview: src } : {}),
        ...(advisorMeta ? { advisorMeta } : {}),
        generationParams: genParams,
      },
    ]);
    trackEvent("collect_toggle", { collected: true, bucket });
    toast.success(`已加入「${DEFAULT_BUCKET_LABELS[bucket]}」收藏`);
  };

  const isFavoriteRow = (replyRowId: string) =>
    favorites.some((f) => f.replyRowId === replyRowId);

  const canPrimaryGenerate = Boolean(selectedImageFile || review.trim());

  const clearReviewInput = () => {
    setReview("");
    setReviewError(null);
    trackEvent("clear_input");
    toast.success("已清空");
  };

  const advisorPrimaryBlocked =
    advisorModeEnabled &&
    advisorStep === "ready_final" &&
    advisorSelectedTendencyIndex === null;

  const advisorPrimaryLabel = !advisorModeEnabled
    ? "生成回复"
    : advisorStep === "need_analysis"
      ? "生成分析"
      : "生成最终回复";

  const followUpModalTarget =
    followUpModal &&
    favorites.find((f) => f.id === followUpModal.favoriteId);

  return (
    <div className="min-h-screen bg-background">
      <div className="h-1 w-full bg-primary" aria-hidden />

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 xl:max-w-7xl">
        {/* 顶部 */}
        <header className="mb-8 text-center sm:mb-10">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            店评小帮
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            店评小帮，帮你轻松回评价・10 秒生成专属回复，自动识截图超省心
          </p>
        </header>

        {/* 中间 · 表单 */}
        <Card className="mb-10 border-border/80 shadow-sm">
          <CardContent className="space-y-6 pt-6 sm:pt-8">
            <div className="space-y-2">
              <Label htmlFor="review" className="text-foreground">
                评价原文
              </Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={EXTRACT_REVIEW_ACCEPT_IMAGES}
                className="sr-only"
                aria-label="选择评价截图文件"
                onChange={onImageSelected}
              />
              <div className="grid min-h-[220px] w-full grid-cols-[minmax(0,1fr)_minmax(0,2fr)] overflow-hidden rounded-xl border border-border/80 sm:min-h-[240px] md:min-h-[260px]">
                {/* 左侧：截图上传（1/3 宽） */}
                <div
                  className={cn(
                    "relative flex h-full min-h-[220px] min-w-0 flex-col border-r border-border/80 bg-muted/10 transition-[box-shadow,background-color] sm:min-h-[240px] md:min-h-[260px]",
                    isDragOver && "bg-primary/15 ring-2 ring-inset ring-primary"
                  )}
                  onDragEnter={onUploadDragEnter}
                  onDragLeave={onUploadDragLeave}
                  onDragOver={onUploadDragOver}
                  onDrop={onUploadDrop}
                >
                  {loading &&
                  selectedImageFile &&
                  (loadingKind === "extract" ||
                    loadingKind === "recognize_extract" ||
                    loadingKind === "recognize_generate") ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
                      <Loader2
                        className="size-10 animate-spin text-primary"
                        aria-hidden
                      />
                      <p className="text-center text-sm text-muted-foreground">
                        {loadingHint?.includes("生成")
                          ? loadingHint
                          : "正在识别…"}
                      </p>
                    </div>
                  ) : imagePreviewUrl && selectedImageFile ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6">
                      <div className="relative max-h-[min(40vh,200px)] w-full max-w-[220px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreviewUrl}
                          alt="已上传的评价截图"
                          className="mx-auto max-h-[min(40vh,200px)] w-auto max-w-full object-contain"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute -right-2 -top-2 size-8 rounded-full shadow-md"
                          disabled={loading}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSelectedImage();
                          }}
                          aria-label="移除图片"
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                      <div className="flex w-full justify-end px-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          className="border-primary bg-background text-foreground hover:bg-primary/10"
                          disabled={loading}
                          onClick={handleExtractOnly}
                        >
                          {loading && loadingKind === "extract" ? (
                            <>
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden
                              />
                              识别中…
                            </>
                          ) : (
                            <>
                              <ScanText className="size-4" aria-hidden />
                              识别文字
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={onPickImageClick}
                      className={cn(
                        "flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                        isDragOver
                          ? "bg-primary/15"
                          : "hover:bg-muted/40"
                      )}
                    >
                      <Upload
                        className="size-12 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="text-base font-medium text-foreground">
                        {isDragOver
                          ? "松开鼠标上传图片"
                          : "截图粘贴/拖拽/点击上传"}
                      </span>
                      <span className="max-w-[200px] text-xs leading-relaxed text-muted-foreground">
                        支持 JPG/PNG 格式，自动识别评价文字
                      </span>
                    </button>
                  )}
                </div>

                {/* 右侧：文本（约 2/3） */}
                <div className="relative flex h-full min-h-[220px] min-w-0 flex-col bg-card sm:min-h-[240px] md:min-h-[260px]">
                  <Textarea
                    id="review"
                    placeholder="或手动粘贴评价内容..."
                    aria-invalid={Boolean(reviewError)}
                    className="min-h-0 flex-1 resize-none rounded-none border-0 px-4 py-4 pr-11 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                    value={review}
                    onChange={(e) => {
                      setReview(e.target.value);
                      if (reviewError) setReviewError(null);
                      if (selectedImageFile || imagePreviewUrl) {
                        clearSelectedImage();
                      }
                    }}
                  />
                  {review.trim() ? (
                    <button
                      type="button"
                      className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                      aria-label="清空评价原文"
                      disabled={loading}
                      onClick={clearReviewInput}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              {reviewError ? (
                <p className="text-sm text-destructive" role="alert">
                  {reviewError}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="category" className="text-foreground">
                  商家品类
                </Label>
                <GroupedCategorySelect
                  id="category"
                  disabled={loading}
                  sentinelValue={CATEGORY_OTHER_SENTINEL}
                  lastOptionLabel="其他（可自定义）"
                  value={categorySelectValue}
                  onValueChange={(v) => {
                    setCategorySelectValue(v);
                    if (v !== CATEGORY_OTHER_SENTINEL) {
                      setCategoryCustomText("");
                    }
                  }}
                  customText={categoryCustomText}
                  onCustomTextChange={setCategoryCustomText}
                  placeholder="例如：宠物医院"
                  maxLength={50}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="style" className="text-foreground">
                  回复语气
                </Label>
                <EditablePresetSelect
                  id="style"
                  disabled={loading}
                  presets={PRESET_STYLE_LIST}
                  sentinelValue={STYLE_CUSTOM_SENTINEL}
                  lastOptionLabel="自定义人设（可编辑）"
                  value={styleSelectValue}
                  onValueChange={(v) => {
                    setStyleSelectValue(v);
                    if (v !== STYLE_CUSTOM_SENTINEL) {
                      setStyleCustomText("");
                    }
                  }}
                  customText={styleCustomText}
                  onCustomTextChange={setStyleCustomText}
                  placeholder="例如：10年老面馆老板，说话接地气"
                  maxLength={100}
                />
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="rating" className="text-foreground">
                  评价类型
                </Label>
                <Select
                  value={ratingType}
                  onValueChange={(v) => {
                    ratingTypeUserLockedRef.current = true;
                    clearRatingAutoHint();
                    setRatingType(v as RatingType);
                    trackEvent("type_change", { ratingType: v });
                  }}
                >
                  <SelectTrigger
                    id="rating"
                    className="h-10 w-full min-w-0"
                    size="default"
                  >
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {RATING_TYPES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ratingAutoHintType ? (
                  <p
                    className="text-xs font-medium leading-tight text-green-600 dark:text-green-500"
                    role="status"
                    aria-live="polite"
                  >
                    已自动识别为：{ratingAutoHintType}
                  </p>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="length-pref" className="text-foreground">
                  长度偏好
                </Label>
                <Select
                  value={lengthPreferenceId}
                  disabled={loading}
                  items={LENGTH_PREFERENCE_SELECT_ITEMS}
                  onValueChange={(v) =>
                    setLengthPreferenceId(v as LengthPreferenceId)
                  }
                >
                  <SelectTrigger
                    id="length-pref"
                    className="h-10 w-full min-w-0"
                    size="default"
                  >
                    <SelectValue placeholder="选择长度" />
                  </SelectTrigger>
                  <SelectContent>
                    {LENGTH_PREFERENCE_OPTIONS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-req" className="text-foreground">
                追加要求（可选）
              </Label>
              <Input
                id="extra-req"
                value={extraRequirements}
                onChange={(e) =>
                  setExtraRequirements(e.target.value.slice(0, 200))
                }
                placeholder='例如：回复中请添加“欢迎下次光临”，不要使用表情'
                disabled={loading}
                className="h-10 w-full"
              />
            </div>

            <div className="space-y-3">
              <label
                htmlFor="advisor-mode"
                className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground"
              >
                <input
                  id="advisor-mode"
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
                  checked={advisorModeEnabled}
                  disabled={loading}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAdvisorModeEnabled(on);
                    if (!on) {
                      setAdvisorStep("need_analysis");
                      setAdvisorCoreAnalysis("");
                      setAdvisorTendencyOptions([]);
                      setAdvisorSelectedTendencyIndex(null);
                      setAdvisorSupplement("");
                      setAdvisorFavoriteSnapshot(null);
                    }
                  }}
                />
                <span>开启参谋模式</span>
              </label>

              {advisorModeEnabled ? (
                <div
                  className="space-y-4 rounded-[8px] border border-border/60 bg-muted/40 p-4 dark:bg-muted/25"
                  role="region"
                  aria-label="参谋模式面板"
                >
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      {advisorAnalysisSectionTitle(ratingType)}
                    </p>
                    <div
                      className="min-h-[4.5rem] rounded-md border border-border/50 bg-background/80 px-3 py-3 text-[14px] leading-[1.65] text-[#333333] dark:text-foreground whitespace-pre-wrap break-words"
                      role="status"
                    >
                      {advisorCoreAnalysis.trim()
                        ? normalizeAdvisorCoreAnalysisDisplay(
                            advisorCoreAnalysis
                          )
                        : "点击下方按钮生成分析"}
                    </div>
                  </div>

                  {advisorStep === "ready_final" ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                            💡 选择回复方案倾向
                          </p>
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[#666666] transition-colors hover:text-[#333333] disabled:pointer-events-none disabled:opacity-50 dark:text-[#a3a3a3] dark:hover:text-[#d4d4d4]"
                            disabled={loading || advisorTendenciesRefreshing}
                            aria-label="换一批回复方案倾向"
                            title="换一批"
                            onClick={() => void refreshAdvisorTendencies()}
                          >
                            <RefreshCw
                              className={cn(
                                "size-4 shrink-0",
                                advisorTendenciesRefreshing && "animate-spin"
                              )}
                              aria-hidden
                            />
                            <span className="hidden text-xs font-normal sm:inline">
                              换一批
                            </span>
                          </button>
                        </div>
                        <div className="flex flex-col gap-2.5">
                          {advisorTendencyOptions.map((line, idx) => (
                            <label
                              key={idx}
                              className="flex cursor-pointer items-start gap-2 text-sm text-foreground"
                            >
                              <input
                                type="radio"
                                name="advisor-tendency"
                                className="mt-1 size-3.5 shrink-0 accent-primary"
                                checked={advisorSelectedTendencyIndex === idx}
                                disabled={loading || advisorTendenciesRefreshing}
                                onChange={() =>
                                  setAdvisorSelectedTendencyIndex(idx)
                                }
                              />
                              <span>{line}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label
                          htmlFor="advisor-supplement"
                          className="text-sm font-semibold text-foreground"
                        >
                          ✏️ 补充额外信息（可选）
                        </Label>
                        <Textarea
                          id="advisor-supplement"
                          value={advisorSupplement}
                          onChange={(e) =>
                            setAdvisorSupplement(e.target.value.slice(0, 500))
                          }
                          placeholder="例如：顾客是老客户、已经联系过顾客、可以赠送优惠券等"
                          disabled={loading || advisorTendenciesRefreshing}
                          rows={3}
                          className="min-h-[80px] max-h-[200px] resize-y border-border/80 text-sm"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <Button
                ref={primaryGenerateButtonRef}
                type="button"
                size="lg"
                variant="default"
                className={cn(
                  "h-12 w-full text-base font-medium sm:flex-1 gap-2 shadow-sm disabled:pointer-events-none disabled:!opacity-100",
                  canPrimaryGenerate && !advisorPrimaryBlocked
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "!border-0 !bg-muted !text-muted-foreground shadow-none hover:!bg-muted"
                )}
                disabled={
                  loading ||
                  advisorTendenciesRefreshing ||
                  !canPrimaryGenerate ||
                  advisorPrimaryBlocked
                }
                onClick={handlePrimaryGenerate}
              >
                {loading &&
                (loadingKind === "generate" ||
                  loadingKind === "recognize_extract" ||
                  loadingKind === "recognize_generate" ||
                  loadingKind === "advisor_analyze" ||
                  loadingKind === "advisor_generate") ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    {loadingKind === "recognize_extract"
                      ? "识别中…"
                      : loadingHint || "生成中…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-5" aria-hidden />
                    {advisorPrimaryLabel}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 底部 · 生成结果与收藏夹纵向全宽堆叠 */}
        <div className="flex w-full min-w-0 flex-col gap-6">
          <section aria-labelledby="results-heading" className="w-full min-w-0">
            <div className="mb-4 flex min-w-0 flex-nowrap items-center justify-between gap-2 scroll-mt-24">
              <h2
                id="results-heading"
                ref={resultsHeadingRef}
                className="min-w-0 flex-1 text-center text-sm font-medium text-muted-foreground sm:text-left"
              >
                生成结果
              </h2>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[#666666] transition-colors hover:text-[#333333] disabled:pointer-events-none disabled:opacity-50 dark:text-[#a3a3a3] dark:hover:text-[#d4d4d4]"
                disabled={
                  loading ||
                  resultsRefreshing ||
                  replyRows.length === 0
                }
                aria-label="换一批生成结果"
                title="换一批"
                onClick={() => void refreshGeneratedResults()}
              >
                <RefreshCw
                  className={cn(
                    "size-4 shrink-0",
                    resultsRefreshing && "animate-spin"
                  )}
                  aria-hidden
                />
                <span className="hidden text-xs font-normal sm:inline">
                  换一批
                </span>
              </button>
            </div>

            {loading ? (
              <div
                className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-xl border border-border/60 bg-muted/20 px-6 py-12"
                aria-busy="true"
                aria-live="polite"
              >
                <Loader2
                  className="size-10 animate-spin text-primary"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  {loadingHint ||
                    (loadingKind === "extract" ||
                    loadingKind === "recognize_extract"
                      ? "正在识别截图…"
                      : loadingKind === "advisor_analyze"
                        ? "正在生成核心分析与回复方案…"
                        : loadingKind === "advisor_generate"
                          ? "正在生成最终回复…"
                          : "正在生成回复，请稍候…")}
                </p>
              </div>
            ) : null}

            {!loading && error ? (
              <div
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-center text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            {!loading && !error && replyRows.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 px-6 py-12 text-center text-sm text-muted-foreground sm:min-h-[240px] sm:text-base">
                生成的回复将显示在这里
              </div>
            ) : null}

            {!loading && !error && replyRows.length > 0 ? (
              <ul className="grid w-full list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {replyRows.map((row, i) => (
                  <li
                    key={row.id}
                    className="flex h-full min-h-0"
                  >
                    <Card className="flex h-full w-full flex-col gap-0 overflow-visible border-border/80 py-0 shadow-sm">
                      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
                        <div className="relative min-h-0 flex-1">
                          <div className="min-w-0 pr-12">
                            {editingReplyId === row.id ? (
                              <Textarea
                                autoFocus
                                value={replyEditDraft}
                                onChange={(e) =>
                                  setReplyEditDraft(e.target.value)
                                }
                                disabled={resultsRefreshing}
                                className="min-h-[8rem] w-full resize-y border-border/80 text-sm leading-relaxed text-foreground shadow-none focus-visible:ring-ring/50"
                                aria-label={`回复 ${i + 1} 编辑`}
                              />
                            ) : (
                              <p className="text-sm leading-relaxed text-foreground">
                                {row.text}
                              </p>
                            )}
                          </div>
                          <div
                            className="absolute right-3 top-3 z-10 shrink-0"
                            data-reply-more-root={row.id}
                          >
                            <button
                              type="button"
                              className="flex size-8 shrink-0 items-center justify-center rounded-[4px] text-[#666666] outline-none transition-colors hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                              aria-expanded={replyMoreMenuOpenId === row.id}
                              aria-haspopup="menu"
                              aria-label="更多"
                              disabled={resultsRefreshing}
                              onClick={() =>
                                setReplyMoreMenuOpenId((id) =>
                                  id === row.id ? null : row.id
                                )
                              }
                            >
                              <MoreVertical
                                className="size-4"
                                strokeWidth={1.75}
                                aria-hidden
                              />
                            </button>
                            {replyMoreMenuOpenId === row.id ? (
                              <div
                                role="menu"
                                aria-orientation="vertical"
                                className="absolute right-0 top-[calc(100%+6px)] z-20 flex w-10 flex-col items-center rounded-lg border border-border/80 bg-card py-2 shadow-md"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={cn(
                                    "flex h-9 w-full shrink-0 items-center justify-center rounded-md transition-colors",
                                    "text-[#666666] hover:bg-[#F5F5F5] hover:text-[#FFD54F]",
                                    replyFeedback[i] === "like" &&
                                      "bg-[#FFFBF0] text-[#FFD54F]"
                                  )}
                                  aria-label={
                                    replyFeedback[i] === "like"
                                      ? "点赞（已选中）"
                                      : "点赞"
                                  }
                                  disabled={resultsRefreshing}
                                  onClick={() => {
                                    handleReplyFeedback(i, "like");
                                    setReplyMoreMenuOpenId(null);
                                  }}
                                >
                                  <ThumbsUp
                                    className="size-4"
                                    strokeWidth={1.75}
                                    aria-hidden
                                  />
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={cn(
                                    "flex h-9 w-full shrink-0 items-center justify-center rounded-md transition-colors",
                                    "text-[#666666] hover:bg-[#F5F5F5] hover:text-[#FFD54F]",
                                    replyFeedback[i] === "dislike" &&
                                      "bg-[#FFFBF0] text-[#FFD54F]"
                                  )}
                                  aria-label={
                                    replyFeedback[i] === "dislike"
                                      ? "点踩（已选中）"
                                      : "点踩"
                                  }
                                  disabled={resultsRefreshing}
                                  onClick={() => {
                                    handleReplyFeedback(i, "dislike");
                                    setReplyMoreMenuOpenId(null);
                                  }}
                                >
                                  <ThumbsDown
                                    className="size-4"
                                    strokeWidth={1.75}
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-auto shrink-0 pt-2" aria-hidden>
                          <div className="h-px w-full bg-[#E5E5E5]" />
                        </div>
                        <div className="shrink-0 pt-2">
                          <div className="flex flex-nowrap items-center justify-end gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                "h-auto shrink-0 gap-1.5 rounded-[8px] border-0 px-4 py-2 text-sm font-medium text-[#333333]",
                                "bg-[#FFD54F] shadow-[0_2px_4px_rgba(255,213,79,0.3)]",
                                "transition-all duration-100",
                                "hover:bg-[#FFCA28] hover:text-[#333333] hover:shadow-[0_3px_6px_rgba(255,202,40,0.4)]",
                                "active:translate-y-px [&_svg]:text-[#333333]"
                              )}
                              disabled={resultsRefreshing}
                              onClick={() =>
                                handleCopy(
                                  editingReplyId === row.id
                                    ? replyEditDraft
                                    : row.text,
                                  i
                                )
                              }
                            >
                              <ClipboardList
                                className="size-3.5"
                                aria-hidden
                              />
                              复制
                            </Button>
                            {editingReplyId === row.id ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-auto shrink-0 gap-1.5 rounded-lg border-[#E5E5E5] bg-white px-2.5 py-2 text-sm font-medium text-[#666666] hover:bg-[#FAFAFA] hover:text-[#666666] dark:border-border dark:bg-card dark:hover:bg-muted/50 [&_svg]:text-[#666666]"
                                disabled={resultsRefreshing}
                                onClick={saveReplyEdit}
                              >
                                <Check className="size-3.5" aria-hidden />
                                保存
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-auto shrink-0 gap-1.5 rounded-lg border-[#E5E5E5] bg-white px-2.5 py-2 text-sm font-medium text-[#666666] hover:bg-[#FAFAFA] hover:text-[#666666] dark:border-border dark:bg-card dark:hover:bg-muted/50 [&_svg]:text-[#666666]"
                                disabled={resultsRefreshing}
                                onClick={() =>
                                  beginReplyEdit(row.id, row.text)
                                }
                              >
                                <Pencil className="size-3.5" aria-hidden />
                                编辑
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-auto shrink-0 gap-1.5 rounded-lg border-[#E5E5E5] bg-white px-2.5 py-2 text-sm font-medium text-[#666666] hover:bg-[#FAFAFA] hover:text-[#666666] dark:border-border dark:bg-card dark:hover:bg-muted/50 [&_svg]:text-[#666666]",
                                isFavoriteRow(row.id) &&
                                  "border-[#FFD54F]/40 bg-[#FFFBF0]"
                              )}
                              aria-pressed={isFavoriteRow(row.id)}
                              disabled={resultsRefreshing}
                              onClick={() =>
                                toggleFavorite(
                                  row.id,
                                  editingReplyId === row.id
                                    ? replyEditDraft
                                    : row.text,
                                  review
                                )
                              }
                              title="按当前「评价类型」归入收藏夹对应分栏"
                            >
                              <Star
                                className={cn(
                                  "size-3.5",
                                  isFavoriteRow(row.id) &&
                                    "fill-[#FFD54F] text-[#FFD54F]"
                                )}
                                aria-hidden
                              />
                              {isFavoriteRow(row.id) ? "已收藏" : "收藏"}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <aside className="w-full min-w-0" aria-label="收藏夹">
            {favoritesHelpOpen ? (
              <div
                className="fixed inset-0 z-[100]"
                aria-hidden
                onClick={() => setFavoritesHelpOpen(false)}
              />
            ) : null}
            <Card
              className={cn(
                "border-border/80 shadow-sm",
                favoritesHelpOpen ? "overflow-visible" : "overflow-hidden"
              )}
            >
              <div className="relative z-[101] flex w-full items-center border-b border-border/80 bg-card">
                <button
                  type="button"
                  onClick={() =>
                    setFavoritesPanelOpen((open) => !open)
                  }
                  className="flex min-w-0 flex-1 items-center py-3 pl-4 pr-2 text-left transition-colors hover:bg-muted/30 sm:pl-5"
                  aria-expanded={favoritesPanelOpen}
                >
                  <span className="text-sm font-semibold text-foreground">
                    收藏夹
                  </span>
                </button>
                <div className="relative shrink-0 py-3">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-[4px] text-[#666666] transition-colors hover:bg-[#F5F5F5]"
                    aria-label="收藏夹说明"
                    aria-expanded={favoritesHelpOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFavoritesHelpOpen((o) => !o);
                    }}
                  >
                    <HelpCircle
                      className="size-4 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                  {favoritesHelpOpen ? (
                    <div
                      role="tooltip"
                      className="absolute right-0 top-[calc(100%+6px)] z-[102] w-[min(18rem,calc(100vw-2rem))] rounded-[8px] border border-[#E5E5E5] bg-white p-3 text-[14px] leading-relaxed text-[#666666] shadow-md dark:border-border dark:bg-card dark:text-muted-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {FAVORITES_HELP_TEXT}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFavoritesPanelOpen((open) => !open)
                  }
                  className="flex shrink-0 items-center py-3 pr-4 pl-1 transition-colors hover:bg-muted/30 sm:pr-5"
                  aria-expanded={favoritesPanelOpen}
                  aria-label={
                    favoritesPanelOpen ? "收起收藏夹" : "展开收藏夹"
                  }
                >
                  <ChevronDown
                    className={cn(
                      "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
                      favoritesPanelOpen && "rotate-180"
                    )}
                    aria-hidden
                  />
                </button>
              </div>
              {favoritesPanelOpen ? (
                <CardContent className="space-y-4 p-4 sm:p-5">
                  {favorites.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                      暂无收藏。在生成结果中点击「收藏」即可按当前评价类型保存到对应分栏。
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div
                        className="flex flex-wrap gap-2 border-b border-border/60 pb-2"
                        role="tablist"
                        aria-label="收藏分栏"
                      >
                        {FAVORITE_BUCKETS.map((bucket) => (
                          <button
                            key={bucket}
                            type="button"
                            role="tab"
                            aria-selected={favoriteTab === bucket}
                            onClick={() => setFavoriteTab(bucket)}
                            className={cn(
                              "rounded-md px-4 py-2 text-sm transition-colors",
                              favoriteTab === bucket
                                ? "bg-primary/15 font-medium text-foreground ring-1 ring-primary/40"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            )}
                          >
                            {DEFAULT_BUCKET_LABELS[bucket]}
                          </button>
                        ))}
                      </div>
                      <ul
                        ref={favoritesListUlRef}
                        className="flex max-h-[min(52vh,26rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border/70 bg-muted/10 p-2"
                        role="tabpanel"
                      >
                        {(() => {
                          const list = favorites
                            .filter((f) =>
                              favoriteMatchesSidebarTab(f, favoriteTab)
                            )
                            .sort((a, b) => b.savedAt - a.savedAt);
                          if (list.length === 0) {
                            return (
                              <li className="py-8 text-center text-xs text-muted-foreground">
                                本栏暂无收藏
                              </li>
                            );
                          }
                          return list.map((item) => {
                            const hasSource = Boolean(
                              (item.sourceReview ?? "").trim()
                            );
                            const sourceCollapsed =
                              favSourceCollapsed[item.id] === true;
                            const latestFuId = getLatestFollowUpId(item);
                            const refreshUiKey =
                              latestFuId != null
                                ? `${item.id}::${latestFuId}`
                                : "";
                            const refreshingFollowUp =
                              latestFuId != null &&
                              followUpRefreshingKey === refreshUiKey;

                            const favOutlineAction =
                              "inline-flex h-auto items-center justify-center gap-1.5 rounded-[8px] border border-[#E5E5E5] bg-white px-4 py-2 text-xs font-medium leading-[1.6] text-[#666666] transition-colors hover:bg-[#FAFAFA] disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:bg-card dark:hover:bg-muted/50";
                            const favDeleteAction =
                              "inline-flex h-auto items-center justify-center gap-1.5 rounded-[8px] border border-transparent px-4 py-2 text-xs font-medium leading-[1.6] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive";

                            return (
                              <li
                                key={item.id}
                                data-favorite-item-root
                                className="rounded-[8px] border border-border/60 bg-background/90 p-3"
                                style={{
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                                }}
                              >
                                <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={!latestFuId || refreshingFollowUp}
                                    className={cn(
                                      favOutlineAction,
                                      "hover:text-[#333333]"
                                    )}
                                    title="换一批"
                                    aria-label="换一批跟进回复"
                                    onClick={() => {
                                      if (!latestFuId) return;
                                      void refreshFollowUpBatch(
                                        item.id,
                                        latestFuId
                                      );
                                    }}
                                  >
                                    {refreshingFollowUp ? (
                                      <>
                                        <RefreshCw
                                          className="size-3.5 shrink-0 animate-spin"
                                          aria-hidden
                                        />
                                        生成中…
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw
                                          className="size-3.5 shrink-0"
                                          aria-hidden
                                        />
                                        换一批
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className={favOutlineAction}
                                    disabled={refreshingFollowUp}
                                    onClick={() =>
                                      setFollowUpModal({
                                        favoriteId: item.id,
                                        branchFollowUpId: latestFuId ?? null,
                                      })
                                    }
                                  >
                                    跟进追评
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className={favDeleteAction}
                                    onClick={() => {
                                      setFavorites((p) =>
                                        p.filter((f) => f.id !== item.id)
                                      );
                                      setFavSourceCollapsed((p) => {
                                        const next = { ...p };
                                        delete next[item.id];
                                        return next;
                                      });
                                      trackEvent("collect_toggle", {
                                        collected: false,
                                        source: "delete",
                                      });
                                      toast.success("已删除");
                                    }}
                                    aria-label="删除该条收藏"
                                  >
                                    <Trash2
                                      className="size-3.5"
                                      aria-hidden
                                    />
                                    删除
                                  </Button>
                                </div>

                                {hasSource ? (
                                  <div className="mb-2">
                                    {!sourceCollapsed ? (
                                      <div
                                        className="relative rounded-[8px] leading-[1.6]"
                                        style={{
                                          backgroundColor: "#F8F8F8",
                                          padding: 12,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-[#666666] outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50"
                                          aria-label="收起原评论"
                                          onClick={() =>
                                            setFavSourceCollapsed((p) => ({
                                              ...p,
                                              [item.id]: true,
                                            }))
                                          }
                                        >
                                          <ChevronUp
                                            className="size-4"
                                            aria-hidden
                                          />
                                        </button>
                                        <p className="pr-10 text-[11px] font-medium leading-[1.6] text-[#333333]">
                                          【原评论】
                                        </p>
                                        <p className="mt-2 whitespace-pre-wrap text-[13px] text-foreground">
                                          {item.sourceReview}
                                        </p>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="w-full rounded-[8px] px-3 py-2 text-left text-xs leading-[1.6] text-muted-foreground transition-colors hover:bg-muted/30"
                                        style={{
                                          backgroundColor: "#F8F8F8",
                                        }}
                                        onClick={() =>
                                          setFavSourceCollapsed((p) => {
                                            const next = { ...p };
                                            delete next[item.id];
                                            return next;
                                          })
                                        }
                                      >
                                        点击展开原评论
                                      </button>
                                    )}
                                  </div>
                                ) : null}

                                <div
                                  className="bg-white leading-[1.6]"
                                  style={{
                                    borderLeft: "3px solid #FFC107",
                                    borderRadius: 8,
                                    padding: 12,
                                    boxShadow:
                                      "0 2px 8px rgba(0,0,0,0.06)",
                                  }}
                                >
                                  <p className="text-[11px] font-medium leading-[1.6] text-[#333333]">
                                    【商家回复】
                                  </p>
                                  <p className="mt-2 text-[13px] leading-[1.6] text-[#333333]">
                                    {item.text}
                                  </p>
                                </div>

                                {item.advisorMeta ? (
                                  <>
                                    <div className="h-2" aria-hidden />
                                    <div className="space-y-2.5 rounded-[8px] border border-border/60 bg-muted/30 p-3 text-left text-[11px] leading-[1.6]">
                                      <div>
                                        <p className="font-semibold text-foreground">
                                          核心分析
                                        </p>
                                        <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                          {normalizeAdvisorCoreAnalysisDisplay(
                                            item.advisorMeta.problemAnalysis
                                          )}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="font-semibold text-foreground">
                                          回复方案倾向
                                        </p>
                                        <p className="mt-1 text-muted-foreground">
                                          {item.advisorMeta.solutionBias}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="font-semibold text-foreground">
                                          补充信息
                                        </p>
                                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                                          {item.advisorMeta.extraInfo.trim()
                                            ? item.advisorMeta.extraInfo
                                            : "（无）"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="font-semibold text-foreground">
                                          最终回复
                                        </p>
                                        <p className="mt-1 whitespace-pre-wrap text-foreground">
                                          {item.text}
                                        </p>
                                      </div>
                                    </div>
                                  </>
                                ) : null}

                                <FavoriteItemFollowUps
                                  item={item}
                                  editingFollowUpKey={editingFollowUpKey}
                                  followUpEditDraft={followUpEditDraft}
                                  setFollowUpEditDraft={setFollowUpEditDraft}
                                  followUpOrdinalMap={followUpOrdinalMap}
                                  formatFollowUpDate={formatFollowUpDate}
                                  onCopy={handleCopy}
                                  onSaveEdit={saveReplyEdit}
                                  onBeginEdit={beginFollowUpEdit}
                                  onToggleFollowUpAdopt={toggleFollowUpAdopt}
                                />
                                <Textarea
                                  value={item.note}
                                  onChange={(e) =>
                                    setFavorites((p) =>
                                      p.map((f) =>
                                        f.id === item.id
                                          ? {
                                              ...f,
                                              note: e.target.value,
                                            }
                                          : f
                                      )
                                    )
                                  }
                                  placeholder="添加备注，方便查找"
                                  rows={2}
                                  className="mt-3 min-h-[2.5rem] resize-y rounded-[8px] text-xs leading-[1.6]"
                                />
                                <div className="mt-3 flex flex-wrap justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="inline-flex h-auto items-center justify-center gap-1.5 rounded-[8px] border-0 bg-[#FFD54F] px-4 py-2 text-xs font-medium leading-[1.6] text-[#333333] shadow-[0_2px_4px_rgba(255,213,79,0.3)] transition-all hover:bg-[#FFCA28] hover:shadow-[0_3px_6px_rgba(255,202,40,0.4)] active:translate-y-px [&_svg]:text-[#333333]"
                                    onClick={() =>
                                      handleCopyFavorite(item.text)
                                    }
                                  >
                                    <Copy
                                      className="size-3.5"
                                      aria-hidden
                                    />
                                    复制
                                  </Button>
                                </div>
                              </li>
                            );
                          });
                        })()}
                      </ul>
                    </div>
                  )}
                </CardContent>
              ) : null}
            </Card>
          </aside>
        </div>

        <p className="mx-auto max-w-3xl px-4 pb-10 pt-2 text-center text-[12px] text-muted-foreground sm:px-6 xl:max-w-7xl">
          AI生成内容仅供参考，请根据实际情况调整使用
        </p>
      </div>

      {followUpModal && followUpModalTarget ? (
        <FavoriteFollowUpModal
          open
          onClose={() => setFollowUpModal(null)}
          originalReview={followUpModalTarget.sourceReview ?? ""}
          lastMerchantReply={getLastMerchantReplyForFollowUp(
            followUpModalTarget,
            followUpModal.branchFollowUpId
          )}
          followUpRatingType={favoriteBucketToRatingType(
            followUpModalTarget.bucket
          )}
          generationParams={resolveFavoriteGenerationParams(
            followUpModalTarget
          )}
          onComplete={(rec) => {
            appendFollowUpToFavorite(followUpModalTarget.id, rec);
          }}
        />
      ) : null}

      {ratingConflict ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
        >
          <Card
            className="w-full max-w-md shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-conflict-title"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="space-y-4 pt-6">
              <p
                id="rating-conflict-title"
                className="text-sm font-medium text-foreground"
              >
                检测到该评价更符合【{ratingConflict.inferred}
                】类型，是否自动切换？
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                当前评价类型为「{ratingConflict.selected}
                」。您可选择切换为系统判断类型，或保持当前选择继续生成。
              </p>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const c = ratingConflict;
                    if (!c) return;
                    setRatingConflict(null);
                    ratingTypeUserLockedRef.current = true;
                    c.resolve(c.selected);
                  }}
                >
                  保持当前
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const c = ratingConflict;
                    if (!c) return;
                    setRatingConflict(null);
                    setRatingType(c.inferred);
                    clearRatingAutoHint();
                    ratingTypeUserLockedRef.current = true;
                    c.resolve(c.inferred);
                  }}
                >
                  切换为{ratingConflict.inferred}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
