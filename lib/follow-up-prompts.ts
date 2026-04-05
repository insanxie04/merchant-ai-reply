import {
  PRESET_STYLE_INSTRUCTIONS,
  type LengthPreferenceBounds,
  type PresetStyle,
} from "@/lib/meituan-reply-prompt";
import type {
  AdvisorRatingType,
  AdvisorReplySchemesGenerationContext,
} from "@/lib/bad-review-advisor";
import { buildAdvisorReplySchemesUserPrompt } from "@/lib/bad-review-advisor";

export const FOLLOW_UP_REPLIES_SYSTEM = `你是资深全渠道商家口碑管理专家。请根据顾客原评价、商家此前回复与买家追评，撰写 3 条差异化的商家跟进回复。
只输出一段合法 JSON，不要任何其他内容。固定结构：{"replies":["第一条","第二条","第三条"]}，数组恰好 3 条字符串。`;

export function buildFollowUpNormalUserPrompt(input: {
  originalReview: string;
  lastMerchantReply: string;
  buyerFollowUp: string;
  category: string;
  presetStyle: PresetStyle;
  customPersona: string | null;
  lengthPreference: LengthPreferenceBounds;
}): string {
  const tone =
    input.customPersona && input.customPersona.trim()
      ? `【回复语气】（自定义人设）\n"""\n${input.customPersona.trim()}\n"""\n`
      : `【回复语气】（预设：${input.presetStyle}）\n${PRESET_STYLE_INSTRUCTIONS[input.presetStyle]}\n`;

  const len = input.lengthPreference;
  return `【行业】${input.category}

${tone}
【长度偏好】${len.label}（每条 ${len.min}–${len.max} 个可见字符，含标点数字）

【顾客原评价】
"""
${input.originalReview}
"""

【商家此前回复】
"""
${input.lastMerchantReply}
"""

【买家追评】
"""
${input.buyerFollowUp}
"""

要求：三条跟进回复在角度、语气、表述上明显不同；紧扣原评价与追评内容；禁止过度承诺；每条字数严格落在长度偏好内。输出 JSON：{"replies":["...","...","..."]}`;
}

export const ADVISOR_FOLLOW_UP_CORE_ANALYSIS_SYSTEM =
  "你是资深全渠道商家口碑管理专家。只输出分析正文，严格使用 1.、2.、3. 分点，每点单独一行；不要总标题、不要 Markdown 代码块、不要任何多余说明。";

export function buildAdvisorFollowUpCoreAnalysisUserPrompt(input: {
  ratingType: AdvisorRatingType;
  originalReview: string;
  lastMerchantReply: string;
  buyerFollowUp: string;
}): string {
  return `你是资深全渠道商家口碑管理专家，请对以下${input.ratingType}进行专业分析（结合买家跟进情境）。

${input.ratingType}原文与情境：
【顾客原评价】
${input.originalReview}

【商家此前回复】
${input.lastMerchantReply}

【买家追评】
${input.buyerFollowUp}

要求：1. 若为差评/中评：提炼1-3个最核心的问题点，分析影响程度和优先级，给出初步改进方向；2. 若为好评：提炼1-2个用户最认可的核心亮点，分析可以放大传播的点；3. 语言简洁明了，严格按1.、2.、3.分点，每点单独换行，不超过200字；4. 只输出分析内容，不要任何其他解释、标题或多余文字`;
}

export function buildAdvisorFollowUpReplySchemesUserPrompt(input: {
  ratingType: AdvisorRatingType;
  originalReview: string;
  lastMerchantReply: string;
  buyerFollowUp: string;
  coreAnalysis: string;
  generationContext?: AdvisorReplySchemesGenerationContext | null;
  diversifyHint?: string | null;
}): string {
  const ctx = `【顾客原评价】${input.originalReview} 【商家此前回复】${input.lastMerchantReply} 【买家追评】${input.buyerFollowUp}`;
  return buildAdvisorReplySchemesUserPrompt(
    input.ratingType,
    ctx,
    input.coreAnalysis,
    input.generationContext ?? null,
    input.diversifyHint ?? null
  );
}

/** @deprecated 使用 buildAdvisorFollowUpReplySchemesUserPrompt */
export const buildAdvisorFollowUpTendenciesUserPrompt =
  buildAdvisorFollowUpReplySchemesUserPrompt;

export const ADVISOR_FOLLOW_UP_FINAL_SYSTEM = `你是资深全渠道商家口碑管理专家。必须结合原评价、商家上次回复、买家追评、核心分析与用户选择的回复方案倾向生成 3 条跟进回复。只输出合法 JSON：{"replies":["第一条","第二条","第三条"]}。`;

export function buildAdvisorFollowUpFinalUserPrompt(input: {
  ratingType: AdvisorRatingType;
  originalReview: string;
  lastMerchantReply: string;
  buyerFollowUp: string;
  coreAnalysis: string;
  prTendency: string;
  userExtra: string;
  category: string;
  presetStyle: PresetStyle;
  customPersona: string | null;
  lengthPreference: LengthPreferenceBounds;
}): string {
  const tone =
    input.customPersona && input.customPersona.trim()
      ? `${input.customPersona.trim()}`
      : `（预设：${input.presetStyle}）\n${PRESET_STYLE_INSTRUCTIONS[input.presetStyle]}`;

  const extra = input.userExtra.trim() || "（无）";
  const len = input.lengthPreference;
  const lenLine = `${len.label}（每条 ${len.min}–${len.max} 个可见字符，含标点数字）`;

  return `你是资深全渠道商家口碑管理专家，请结合以下信息生成 3 条差异化 ${input.ratingType} 跟进回复：1.情境概要——原评价：${input.originalReview}；商家上次回复：${input.lastMerchantReply}；买家追评：${input.buyerFollowUp} 2. 核心分析：${input.coreAnalysis} 3. 用户选择的回复方案倾向：${input.prTendency} 4. 用户补充信息：${extra} 5. 行业：${input.category} 6. 回复语气：${tone} 7. 长度偏好：${lenLine}，要求严格遵循所选回复方案倾向、融入补充信息、三条回复差异化、不过度承诺、符合字数要求，只输出合法 JSON，结构为 {"replies":["第一条","第二条","第三条"]}。`;
}
