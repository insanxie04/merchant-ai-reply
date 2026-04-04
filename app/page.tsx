"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EditablePresetSelect } from "@/components/ui/editable-preset-select";
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
  createFavoriteId,
  DEFAULT_BUCKET_LABELS,
  FAVORITES_STORAGE_KEY,
  FAVORITE_BUCKETS,
  type FavoriteBucket,
  type FavoriteItem,
  parseFavoritesJson,
  ratingTypeToBucket,
  serializeFavorites,
} from "@/lib/favorites-storage";
import { CATEGORY_PRESET_LIST } from "@/lib/merchant-categories";
import {
  PRESET_STYLE_LIST,
  type PresetStyle,
} from "@/lib/meituan-reply-prompt";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  ChevronDown,
  Copy,
  Loader2,
  ScanText,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPT_IMAGES = "image/jpeg,image/png,image/webp,image/gif";
const FAVORITES_LEGACY_KEY = "dianping-xiaobang-favorites-v1";

type ReplyFeedback = "like" | "dislike";

const RATING_TYPES = ["好评", "中评", "差评"] as const;

type RatingType = (typeof RATING_TYPES)[number];

const CATEGORY_OTHER_SENTINEL = "__category_other__";
const STYLE_CUSTOM_SENTINEL = "__style_custom_persona__";

type LoadingKind = "idle" | "extract" | "generate" | "recognize_generate";

async function requestGeneratedReplies(params: {
  review: string;
  category: string;
  style: PresetStyle;
  ratingType: RatingType;
  customPersona?: string;
}): Promise<string[]> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }

  const body: Record<string, unknown> = {
    review: params.review,
    category: params.category,
    style: params.style,
    ratingType: params.ratingType,
  };
  const persona = params.customPersona?.trim();
  if (persona) body.customPersona = persona;

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

function readFileAsBase64Payload(file: File): Promise<{
  mimeType: string;
  imageBase64: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("无法读取图片文件。"));
        return;
      }
      const comma = dataUrl.indexOf(",");
      if (comma === -1) {
        reject(new Error("图片编码失败，请换一张重试。"));
        return;
      }
      const header = dataUrl.slice(0, comma);
      const imageBase64 = dataUrl.slice(comma + 1).trim();
      const hm = /^data:([^;]+);base64$/i.exec(header);
      if (!hm || !imageBase64) {
        reject(new Error("图片编码失败，请换一张重试。"));
        return;
      }
      resolve({
        mimeType: hm[1].trim().toLowerCase(),
        imageBase64,
      });
    };
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

async function requestExtractReview(file: File): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }

  const { mimeType, imageBase64 } = await readFileAsBase64Payload(file);

  let res: Response;
  try {
    res = await fetch("/api/extract-review-from-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType, imageBase64 }),
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

  const payload = data as { error?: string; review?: unknown };

  if (!res.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `识图失败（${res.status}），请稍后重试。`
    );
  }

  if (typeof payload.review !== "string" || !payload.review.trim()) {
    throw new Error("识图返回数据异常，请重试。");
  }

  return payload.review.trim();
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const loadingRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [review, setReview] = useState("");
  const [categorySelectValue, setCategorySelectValue] = useState("餐饮");
  const [categoryCustomText, setCategoryCustomText] = useState("");
  const [styleSelectValue, setStyleSelectValue] = useState("亲切热情");
  const [styleCustomText, setStyleCustomText] = useState("");
  const [ratingType, setRatingType] = useState<RatingType>("好评");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState<LoadingKind>("idle");
  const [loadingHint, setLoadingHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<string[]>([]);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [replyFeedback, setReplyFeedback] = useState<
    Partial<Record<number, ReplyFeedback>>
  >({});
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [favoritesPanelOpen, setFavoritesPanelOpen] = useState(false);
  const [favoriteTab, setFavoriteTab] = useState<FavoriteBucket>("praise");

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

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
    setSelectedImageFile(null);
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
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(
          `图片需小于 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB，请先压缩或裁剪`
        );
        return false;
      }
      setImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setSelectedImageFile(file);
      return true;
    },
    []
  );

  const runExtractWithFile = useCallback(async (file: File) => {
    if (loadingRef.current) return;
    setError(null);
    setReplies([]);
    setReplyFeedback({});
    setLoading(true);
    setLoadingKind("extract");
    setLoadingHint("正在识别截图中的评价文字…");

    try {
      const text = await requestExtractReview(file);
      setReview(text);
      setReviewError(null);
      toast.success("已填入识别结果，可修改后再生成回复");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "识图失败，请稍后重试。";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setLoadingKind("idle");
      setLoadingHint("");
    }
  }, []);

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
          void runExtractWithFile(file);
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
    await runExtractWithFile(selectedImageFile);
  };

  const handleRecognizeAndGenerate = async () => {
    if (!selectedImageFile) {
      toast.error("请先选择评价截图");
      return;
    }
    setReviewError(null);
    setError(null);
    setReplies([]);
    setReplyFeedback({});
    setLoading(true);
    setLoadingKind("recognize_generate");
    setLoadingHint("正在识别截图中的评价文字…");

    try {
      const text = await requestExtractReview(selectedImageFile);
      setReview(text);
      setLoadingHint("正在生成回复…");
      const cat = getEffectiveCategory();
      if (!cat) {
        toast.error("请选择或输入商家品类");
        return;
      }
      const customPersona = getEffectiveCustomPersona();
      const next = await requestGeneratedReplies({
        review: text,
        category: cat,
        style: getApiStyle(),
        ratingType,
        ...(customPersona ? { customPersona } : {}),
      });
      setReplies(next);
      toast.success("已识图并生成 3 条回复");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "处理失败，请稍后重试。";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setLoadingKind("idle");
      setLoadingHint("");
    }
  };

  const handleGenerate = async () => {
    const trimmed = review.trim();
    if (!trimmed) {
      setReviewError("请粘贴或输入美团评价内容");
      return;
    }
    setReviewError(null);
    setError(null);
    setReplies([]);
    setReplyFeedback({});
    setLoading(true);
    setLoadingKind("generate");
    setLoadingHint("正在生成回复…");

    try {
      const cat = getEffectiveCategory();
      if (!cat) {
        toast.error("请选择或输入商家品类");
        return;
      }
      const customPersona = getEffectiveCustomPersona();
      const next = await requestGeneratedReplies({
        review: trimmed,
        category: cat,
        style: getApiStyle(),
        ratingType,
        ...(customPersona ? { customPersona } : {}),
      });
      setReplies(next);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "生成失败，请稍后重试。";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setLoadingKind("idle");
      setLoadingHint("");
    }
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`回复 ${index + 1} 已复制到剪贴板`);
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  const handleCopyFavorite = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制收藏内容");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  const handleReplyFeedback = (index: number, kind: ReplyFeedback) => {
    const cur = replyFeedback[index];
    if (cur === kind) {
      setReplyFeedback((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      toast.message("已取消该条反馈");
      return;
    }
    setReplyFeedback((prev) => ({ ...prev, [index]: kind }));
    toast.success(
      kind === "like"
        ? "感谢点赞，已记录反馈"
        : "已记录反馈，我们会持续改进"
    );
  };

  const toggleFavorite = (text: string) => {
    const existing = favorites.find((f) => f.text === text);
    if (existing) {
      setFavorites((p) => p.filter((f) => f.id !== existing.id));
      toast.success("已取消收藏");
      return;
    }
    const bucket = ratingTypeToBucket(ratingType);
    setFavorites((p) => [
      ...p,
      {
        id: createFavoriteId(),
        text,
        savedAt: Date.now(),
        bucket,
        note: "",
      },
    ]);
    toast.success(`已加入「${DEFAULT_BUCKET_LABELS[bucket]}」收藏`);
  };

  const isFavoriteText = (text: string) =>
    favorites.some((f) => f.text === text);

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
                accept={ACCEPT_IMAGES}
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
                <div className="flex h-full min-h-[220px] min-w-0 flex-col bg-card sm:min-h-[240px] md:min-h-[260px]">
                  <Textarea
                    id="review"
                    placeholder="或手动粘贴美团评价内容..."
                    aria-invalid={Boolean(reviewError)}
                    className="min-h-0 flex-1 resize-none rounded-none border-0 px-4 py-4 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                    value={review}
                    onChange={(e) => {
                      setReview(e.target.value);
                      if (reviewError) setReviewError(null);
                      if (selectedImageFile || imagePreviewUrl) {
                        clearSelectedImage();
                      }
                    }}
                  />
                </div>
              </div>
              {reviewError ? (
                <p className="text-sm text-destructive" role="alert">
                  {reviewError}
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="category">商家品类</Label>
                <EditablePresetSelect
                  id="category"
                  disabled={loading}
                  presets={CATEGORY_PRESET_LIST}
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

              <div className="space-y-2">
                <Label htmlFor="style">回复风格</Label>
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

              <div className="space-y-2">
                <Label htmlFor="rating">评价类型</Label>
                <Select
                  value={ratingType}
                  onValueChange={(v) => setRatingType(v as RatingType)}
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
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="h-12 flex-1 text-base font-medium"
                disabled={loading}
                onClick={handleGenerate}
              >
                {loading && loadingKind === "generate" ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    {loadingHint || "生成中…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-5" aria-hidden />
                    生成回复
                  </>
                )}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="h-12 flex-1 gap-2 text-base font-medium"
                disabled={loading || !selectedImageFile}
                onClick={handleRecognizeAndGenerate}
              >
                {loading && loadingKind === "recognize_generate" ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    {loadingHint || "处理中…"}
                  </>
                ) : (
                  <>
                    <ScanText className="size-5" aria-hidden />
                    识别并生成
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 底部 · 生成结果与收藏夹纵向全宽堆叠 */}
        <div className="flex w-full min-w-0 flex-col gap-6">
          <section aria-labelledby="results-heading" className="w-full min-w-0">
            <h2
              id="results-heading"
              className="mb-4 text-center text-sm font-medium text-muted-foreground sm:text-left"
            >
              生成结果
            </h2>

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
                    (loadingKind === "extract"
                      ? "正在识别截图…"
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

            {!loading && !error && replies.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 px-6 py-12 text-center text-sm text-muted-foreground sm:min-h-[240px] sm:text-base">
                生成的回复将显示在这里
              </div>
            ) : null}

            {!loading && !error && replies.length > 0 ? (
              <ul className="grid w-full list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {replies.map((text, i) => (
                  <li
                    key={`${i}-${text.slice(0, 24)}`}
                    className="flex h-full min-h-0"
                  >
                    <Card className="flex h-full w-full flex-col border-border/80 shadow-sm">
                      <CardContent className="flex flex-1 flex-col gap-4 px-5 pt-6 pb-5">
                        <p className="min-h-0 flex-1 text-sm leading-relaxed text-foreground">
                          {text}
                        </p>
                        <div className="mt-auto flex flex-col gap-2 border-t border-border/60 pt-4">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant={
                                replyFeedback[i] === "like"
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              className={cn(
                                "gap-1",
                                replyFeedback[i] === "like" &&
                                  "bg-primary text-primary-foreground"
                              )}
                              aria-pressed={replyFeedback[i] === "like"}
                              onClick={() => handleReplyFeedback(i, "like")}
                            >
                              <ThumbsUp className="size-3.5" aria-hidden />
                              点赞
                            </Button>
                            <Button
                              type="button"
                              variant={
                                replyFeedback[i] === "dislike"
                                  ? "secondary"
                                  : "outline"
                              }
                              size="sm"
                              className="gap-1"
                              aria-pressed={replyFeedback[i] === "dislike"}
                              onClick={() => handleReplyFeedback(i, "dislike")}
                            >
                              <ThumbsDown className="size-3.5" aria-hidden />
                              点踩
                            </Button>
                            <Button
                              type="button"
                              variant={
                                isFavoriteText(text) ? "secondary" : "outline"
                              }
                              size="sm"
                              className="gap-1"
                              aria-pressed={isFavoriteText(text)}
                              onClick={() => toggleFavorite(text)}
                              title="按当前「评价类型」归入收藏夹对应分栏"
                            >
                              <Bookmark
                                className={cn(
                                  "size-3.5",
                                  isFavoriteText(text) && "fill-current"
                                )}
                                aria-hidden
                              />
                              {isFavoriteText(text) ? "已收藏" : "收藏"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleCopy(text, i)}
                            >
                              <Copy className="size-3.5" aria-hidden />
                              复制
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
            <Card className="overflow-hidden border-border/80 shadow-sm">
              <button
                type="button"
                onClick={() =>
                  setFavoritesPanelOpen((open) => !open)
                }
                className="flex w-full items-center justify-between gap-3 border-b border-border/80 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/30 sm:px-5"
                aria-expanded={favoritesPanelOpen}
              >
                <span className="text-sm font-semibold text-foreground">
                  收藏夹
                </span>
                <ChevronDown
                  className={cn(
                    "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
                    favoritesPanelOpen && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              {favoritesPanelOpen ? (
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    每条可写备注。数据保存在本地浏览器。点击「收藏」时按上方「评价类型」保存到对应分栏（好评 / 中评 / 差评）。
                  </p>

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
                        className="flex max-h-[min(52vh,26rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border/70 bg-muted/10 p-2"
                        role="tabpanel"
                      >
                        {(() => {
                          const list = favorites
                            .filter((f) => f.bucket === favoriteTab)
                            .sort((a, b) => b.savedAt - a.savedAt);
                          if (list.length === 0) {
                            return (
                              <li className="py-8 text-center text-xs text-muted-foreground">
                                本栏暂无收藏
                              </li>
                            );
                          }
                          return list.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-md border border-border/60 bg-background/90 p-3 shadow-sm"
                            >
                              <p className="line-clamp-4 text-[11px] leading-relaxed text-foreground">
                                {item.text}
                              </p>
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
                                placeholder="备注（可选）"
                                rows={2}
                                className="mt-2 min-h-[2.5rem] resize-y text-[11px] leading-snug"
                              />
                              <div className="mt-2 flex flex-wrap justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-[10px]"
                                  onClick={() =>
                                    handleCopyFavorite(item.text)
                                  }
                                >
                                  <Copy className="size-3" aria-hidden />
                                  复制
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    setFavorites((p) =>
                                      p.filter((f) => f.id !== item.id)
                                    );
                                    toast.success("已删除");
                                  }}
                                  aria-label="删除该条收藏"
                                >
                                  <Trash2
                                    className="size-3"
                                    aria-hidden
                                  />
                                  删除
                                </Button>
                              </div>
                            </li>
                          ));
                        })()}
                      </ul>
                    </div>
                  )}
                </CardContent>
              ) : null}
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
