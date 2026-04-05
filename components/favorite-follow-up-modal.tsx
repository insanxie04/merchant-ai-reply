"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EXTRACT_REVIEW_ACCEPT_IMAGES,
  EXTRACT_REVIEW_MAX_IMAGE_BYTES,
  requestExtractReviewFromImage,
} from "@/lib/extract-review-from-image-client";
import type {
  FavoriteFollowUpRecord,
  FavoriteGenerationParams,
} from "@/lib/favorites-storage";
import { createFavoriteId } from "@/lib/favorites-storage";
import { normalizeAdvisorCoreAnalysisDisplay } from "@/lib/bad-review-advisor";
import type { PresetStyle } from "@/lib/meituan-reply-prompt";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, ScanText, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";

type FollowUpRatingType = "好评" | "中评" | "差评";

type AdvisorStep = "need_analysis" | "ready_final";

type ModalInfoTab = "buyer" | "original" | "last";

function advisorAnalysisSectionTitle(ratingType: FollowUpRatingType): string {
  if (ratingType === "好评") return "📊 好评核心亮点分析";
  if (ratingType === "中评") return "📊 中评核心问题分析";
  return "📊 差评核心问题分析";
}

export type FavoriteFollowUpModalProps = {
  open: boolean;
  onClose: () => void;
  originalReview: string;
  lastMerchantReply: string;
  /** 收藏项所在分栏对应的评价类型 */
  followUpRatingType: FollowUpRatingType;
  generationParams: FavoriteGenerationParams;
  onComplete: (record: FavoriteFollowUpRecord) => void;
};

async function postJson<T>(
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("服务器返回了无法解析的数据。");
  }
  const o = data as {
    error?: string;
    replies?: string[];
    analysis?: string;
    tendencies?: string[];
  };
  if (!res.ok) {
    throw new Error(
      typeof o.error === "string" && o.error ? o.error : "请求失败，请重试。"
    );
  }
  return data as T;
}

export function FavoriteFollowUpModal({
  open,
  onClose,
  originalReview,
  lastMerchantReply,
  followUpRatingType,
  generationParams,
  onComplete,
}: FavoriteFollowUpModalProps) {
  const followUpImageInputRef = useRef<HTMLInputElement>(null);
  const [buyerText, setBuyerText] = useState("");
  const [followUpImageFile, setFollowUpImageFile] = useState<File | null>(null);
  const [followUpImagePreviewUrl, setFollowUpImagePreviewUrl] = useState<
    string | null
  >(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [modalAdvEnabled, setModalAdvEnabled] = useState(false);
  const [advisorStep, setAdvisorStep] = useState<AdvisorStep>("need_analysis");
  const [analysis, setAnalysis] = useState("");
  const [tendencyOptions, setTendencyOptions] = useState<string[]>([]);
  const [selectedTendencyIndex, setSelectedTendencyIndex] = useState<
    number | null
  >(null);
  const [supplement, setSupplement] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("");
  const [tendenciesRefreshing, setTendenciesRefreshing] = useState(false);
  const [modalInfoTab, setModalInfoTab] = useState<ModalInfoTab>("buyer");

  useEffect(() => {
    if (!open) return;
    setBuyerText("");
    setFollowUpImageFile(null);
    setFollowUpImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setOcrLoading(false);
    setModalAdvEnabled(false);
    setAdvisorStep("need_analysis");
    setAnalysis("");
    setTendencyOptions([]);
    setSelectedTendencyIndex(null);
    setSupplement("");
    setLoading(false);
    setLoadingHint("");
    setTendenciesRefreshing(false);
    setModalInfoTab("buyer");
  }, [open]);

  useEffect(() => {
    if (open) return;
    setFollowUpImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFollowUpImageFile(null);
  }, [open]);

  const assignFollowUpImage = (file: File | null) => {
    if (!file) return;
    if (file.size > EXTRACT_REVIEW_MAX_IMAGE_BYTES) {
      toast.error(
        `图片需小于 ${EXTRACT_REVIEW_MAX_IMAGE_BYTES / (1024 * 1024)}MB，请先压缩或裁剪`
      );
      return;
    }
    if (followUpImagePreviewUrl) {
      URL.revokeObjectURL(followUpImagePreviewUrl);
    }
    setFollowUpImageFile(file);
    setFollowUpImagePreviewUrl(URL.createObjectURL(file));
  };

  const clearFollowUpImage = () => {
    if (followUpImagePreviewUrl) {
      URL.revokeObjectURL(followUpImagePreviewUrl);
    }
    setFollowUpImageFile(null);
    setFollowUpImagePreviewUrl(null);
    if (followUpImageInputRef.current) followUpImageInputRef.current.value = "";
  };

  const handleExtractFollowUpImage = async () => {
    if (!followUpImageFile) {
      toast.error("请先选择追评截图");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("当前网络不可用");
      return;
    }
    setOcrLoading(true);
    setLoadingHint("正在识别追评截图…");
    try {
      const text = await requestExtractReviewFromImage(followUpImageFile);
      setBuyerText(text.slice(0, 2000));
      toast.success("识别成功，已填入买家追评");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "识别失败，请重试";
      toast.error(msg);
    } finally {
      setOcrLoading(false);
      setLoadingHint("");
    }
  };

  const inputBusy = loading || ocrLoading || tendenciesRefreshing;

  const style = generationParams.style as PresetStyle;
  const lengthPref = generationParams.lengthPreference;
  const persona = generationParams.customPersona?.trim();

  const canSubmit =
    buyerText.trim().length > 0 &&
    !loading &&
    !ocrLoading &&
    !tendenciesRefreshing;

  const advisorPrimaryBlocked =
    modalAdvEnabled &&
    advisorStep === "ready_final" &&
    selectedTendencyIndex === null;

  const primaryEnabled = canSubmit && !advisorPrimaryBlocked;

  const primaryLabel = !modalAdvEnabled
    ? "生成跟进回复"
    : advisorStep === "need_analysis"
      ? "生成分析"
      : "生成最终回复";

  const refreshModalAdvisorTendencies = async () => {
    if (!modalAdvEnabled || advisorStep !== "ready_final") return;
    const pa = analysis.trim();
    if (!pa) {
      toast.error("请先完成核心分析");
      return;
    }
    if (!buyerText.trim()) {
      toast.error("请填写买家追评");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("当前网络不可用");
      return;
    }
    const dismiss = toast.loading("正在换一批回复方案…");
    setTendenciesRefreshing(true);
    setSelectedTendencyIndex(null);
    try {
      const { tendencies } = await postJson<{ tendencies: string[] }>(
        "/api/advisor-follow-up-tendencies",
        {
          originalReview: originalReview.trim(),
          lastMerchantReply: lastMerchantReply.trim(),
          buyerFollowUp: buyerText.trim(),
          category: generationParams.category,
          style,
          lengthPreference: lengthPref,
          ...(persona ? { customPersona: persona } : {}),
          ratingType: followUpRatingType,
          coreAnalysis: pa,
          diversifyNonce: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        }
      );
      setTendencyOptions(tendencies);
      toast.success("已换一批回复方案", { id: dismiss });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "换一批失败，请重试";
      toast.error(msg, { id: dismiss });
    } finally {
      setTendenciesRefreshing(false);
    }
  };

  const handleGenerate = async () => {
    if (!buyerText.trim()) {
      toast.error("请填写买家追评");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("当前网络不可用");
      return;
    }

    const base = {
      originalReview: originalReview.trim(),
      lastMerchantReply: lastMerchantReply.trim(),
      buyerFollowUp: buyerText.trim(),
      category: generationParams.category,
      style,
      lengthPreference: lengthPref,
      ...(persona ? { customPersona: persona } : {}),
    };

    setLoading(true);
    try {
      if (modalAdvEnabled) {
        if (advisorStep === "need_analysis") {
          setLoadingHint("正在生成核心分析与回复方案…");
          const { analysis: a } = await postJson<{ analysis: string }>(
            "/api/advisor-follow-up-core-analysis",
            { ...base, ratingType: followUpRatingType }
          );
          const { tendencies } = await postJson<{ tendencies: string[] }>(
            "/api/advisor-follow-up-tendencies",
            {
              ...base,
              ratingType: followUpRatingType,
              coreAnalysis: a,
            }
          );
          setAnalysis(a);
          setTendencyOptions(tendencies);
          setSelectedTendencyIndex(null);
          setAdvisorStep("ready_final");
          toast.success("核心分析与回复方案生成成功");
          return;
        }
        const pa = analysis.trim();
        if (!pa) {
          toast.error("请先完成参谋分析");
          return;
        }
        if (
          selectedTendencyIndex === null ||
          !tendencyOptions[selectedTendencyIndex]
        ) {
          toast.error("请先选择回复方案倾向");
          return;
        }
        const selectedLine = tendencyOptions[selectedTendencyIndex]!;
        setLoadingHint("正在生成最终回复…");
        const { replies } = await postJson<{ replies: string[] }>(
          "/api/generate-replies-advisor-follow-up",
          {
            ...base,
            ratingType: followUpRatingType,
            problemAnalysis: pa,
            solutionBias: selectedLine,
            userExtra: supplement.trim(),
          }
        );
        const record: FavoriteFollowUpRecord = {
          id: createFavoriteId(),
          buyerFollowUp: buyerText.trim(),
          replyRows: replies.map((text) => ({
            id: createFavoriteId(),
            text,
          })),
          usedAdvisor: true,
          problemAnalysis: pa,
          solutionBias: selectedLine,
          extraInfo: supplement.trim(),
          createdAt: Date.now(),
        };
        onComplete(record);
        toast.success("跟进回复生成成功");
        toast.success("保存成功");
        onClose();
        return;
      }

      setLoadingHint("正在生成跟进回复…");
      const { replies } = await postJson<{ replies: string[] }>(
        "/api/generate-follow-up-replies",
        base
      );
      const record: FavoriteFollowUpRecord = {
        id: createFavoriteId(),
        buyerFollowUp: buyerText.trim(),
        replyRows: replies.map((text) => ({
          id: createFavoriteId(),
          text,
        })),
        usedAdvisor: false,
        createdAt: Date.now(),
      };
      onComplete(record);
      toast.success("跟进回复生成成功");
      toast.success("保存成功");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "生成失败，请重试";
      toast.error(msg);
    } finally {
      setLoading(false);
      setLoadingHint("");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[60vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="follow-up-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-4 py-3">
          <h2
            id="follow-up-modal-title"
            className="text-base font-semibold text-foreground"
          >
            评价跟进
          </h2>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            aria-label="关闭"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          className="flex shrink-0 gap-0 border-b border-border/80 px-2"
          role="tablist"
          aria-label="参考信息"
        >
          {(
            [
              { id: "buyer" as const, label: "买家追评" },
              { id: "original" as const, label: "原评价" },
              { id: "last" as const, label: "上次回复" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={modalInfoTab === t.id}
              onClick={() => setModalInfoTab(t.id)}
              className={cn(
                "min-w-0 flex-1 rounded-t-lg px-2 py-2.5 text-center text-sm font-medium leading-[1.6] transition-colors sm:px-3",
                modalInfoTab === t.id
                  ? "border-b-2 border-primary bg-primary/10 text-foreground"
                  : "border-b-2 border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {modalInfoTab === "original" ? (
            <div
              className="rounded-[8px] text-sm leading-[1.6] text-foreground"
              style={{ backgroundColor: "#F8F8F8", padding: 12 }}
            >
              {originalReview.trim() || "（无）"}
            </div>
          ) : modalInfoTab === "last" ? (
            <div
              className="whitespace-pre-wrap rounded-[8px] text-sm leading-[1.6] text-foreground"
              style={{ backgroundColor: "#F8F8F8", padding: 12 }}
            >
              {lastMerchantReply.trim() || "（无）"}
            </div>
          ) : (
            <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="buyer-follow-up"
                className="text-sm font-semibold leading-[1.6] text-foreground"
              >
                买家追评
              </Label>
              <input
                ref={followUpImageInputRef}
                type="file"
                accept={EXTRACT_REVIEW_ACCEPT_IMAGES}
                className="sr-only"
                aria-label="选择追评截图"
                disabled={inputBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) assignFollowUpImage(file);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-border/80 text-xs"
                  disabled={inputBusy}
                  onClick={() => followUpImageInputRef.current?.click()}
                >
                  <Upload className="size-3.5" aria-hidden />
                  上传截图
                </Button>
                {followUpImageFile ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 border-primary/60 bg-background text-xs text-foreground hover:bg-primary/10"
                      disabled={inputBusy}
                      onClick={() => void handleExtractFollowUpImage()}
                    >
                      {ocrLoading ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <ScanText className="size-3.5" aria-hidden />
                      )}
                      识别追评文字
                    </Button>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="移除截图"
                      disabled={inputBusy}
                      onClick={clearFollowUpImage}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </>
                ) : null}
              </div>
              {followUpImagePreviewUrl ? (
                <div className="relative inline-block max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={followUpImagePreviewUrl}
                    alt="追评截图预览"
                    className="max-h-[100px] max-w-full rounded-md border border-border/60 object-contain"
                  />
                </div>
              ) : null}
              <Textarea
                id="buyer-follow-up"
                value={buyerText}
                onChange={(e) => setBuyerText(e.target.value.slice(0, 2000))}
                placeholder="请输入买家的追评内容，或上传截图后点击「识别追评文字」"
                disabled={inputBusy}
                className="min-h-[120px] resize-y border-border/80 text-sm"
              />
            </div>

            <div className="space-y-3 rounded-[8px] border border-border/60 bg-muted/40 p-3 dark:bg-muted/25">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
                  checked={modalAdvEnabled}
                  disabled={inputBusy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setModalAdvEnabled(on);
                    if (!on) {
                      setAdvisorStep("need_analysis");
                      setAnalysis("");
                      setTendencyOptions([]);
                      setSelectedTendencyIndex(null);
                      setSupplement("");
                    }
                  }}
                />
                <span>开启参谋模式</span>
              </label>

              {modalAdvEnabled ? (
                <div className="space-y-3 border-t border-border/50 pt-3">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      {advisorAnalysisSectionTitle(followUpRatingType)}
                    </p>
                    <div className="min-h-[3rem] rounded-md border border-border/50 bg-background/80 px-3 py-3 text-[14px] leading-[1.65] text-[#333333] dark:text-foreground whitespace-pre-wrap break-words">
                      {analysis.trim()
                        ? normalizeAdvisorCoreAnalysisDisplay(analysis)
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
                            disabled={inputBusy}
                            aria-label="换一批回复方案倾向"
                            title="换一批"
                            onClick={() => void refreshModalAdvisorTendencies()}
                          >
                            <RefreshCw
                              className={cn(
                                "size-4 shrink-0",
                                tendenciesRefreshing && "animate-spin"
                              )}
                              aria-hidden
                            />
                            <span className="hidden text-xs font-normal sm:inline">
                              换一批
                            </span>
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          {tendencyOptions.map((line, idx) => (
                            <label
                              key={idx}
                              className="flex cursor-pointer items-start gap-2 text-sm"
                            >
                              <input
                                type="radio"
                                name="modal-advisor-tendency"
                                className="mt-1 size-3.5 accent-primary"
                                checked={selectedTendencyIndex === idx}
                                disabled={inputBusy}
                                onChange={() => setSelectedTendencyIndex(idx)}
                              />
                              <span>{line}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-foreground">
                          ✏️ 补充额外信息（可选）
                        </Label>
                        <Textarea
                          value={supplement}
                          onChange={(e) =>
                            setSupplement(e.target.value.slice(0, 500))
                          }
                          placeholder="例如：顾客是老客户、已电话沟通等"
                          disabled={inputBusy}
                          rows={2}
                          className="min-h-[72px] resize-y border-border/80 text-sm"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/80 p-4">
          <Button
            type="button"
            size="lg"
            variant="default"
            disabled={!primaryEnabled}
            className={cn(
              "h-12 w-full gap-2 text-base font-medium shadow-sm",
              primaryEnabled
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "!border-0 !bg-muted !text-muted-foreground"
            )}
            onClick={() => void handleGenerate()}
          >
            {loading || ocrLoading || tendenciesRefreshing ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                {ocrLoading
                  ? loadingHint || "识别中…"
                  : tendenciesRefreshing
                    ? "正在换一批…"
                    : loadingHint || "生成中…"}
              </>
            ) : (
              <>
                <Sparkles className="size-5" />
                {primaryLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
