import {
  PRESET_STYLE_INSTRUCTIONS,
  type LengthPreferenceBounds,
  type PresetStyle,
} from "@/lib/meituan-reply-prompt";

/** 参谋模式适用的评价类型（与页面 RatingType 一致） */
export type AdvisorRatingType = "好评" | "中评" | "差评";

export const ADVISOR_CORE_ANALYSIS_SYSTEM =
  "你是资深全渠道商家口碑管理专家。只输出分析正文，严格使用 1.、2.、3. 分点，每点单独一行；不要总标题、不要 Markdown 代码块、不要任何多余说明。";

export function buildAdvisorCoreAnalysisUserPrompt(
  ratingType: AdvisorRatingType,
  review: string
): string {
  return `你是资深全渠道商家口碑管理专家，请对以下${ratingType}进行专业分析：${ratingType}原文：${review} 要求：1. 若为差评/中评：提炼1-3个最核心的问题点，分析影响程度和优先级，给出初步改进方向；2. 若为好评：提炼1-2个用户最认可的核心亮点，分析可以放大传播的点；3. 语言简洁明了，严格按1.、2.、3.分点，每点单独换行，不超过200字；4. 只输出分析内容，不要任何其他解释、标题或多余文字`;
}

/** 展示用：保留换行，并在未换行的「2.」「3.」前补换行，便于分点阅读 */
export function normalizeAdvisorCoreAnalysisDisplay(text: string): string {
  const t = text.trim();
  if (!t) return text;
  let s = t.replace(/\r\n/g, "\n");
  s = s.replace(/([^\n])\s*([23])\.\s*/g, "$1\n$2. ");
  return s;
}

export const ADVISOR_REPLY_SCHEMES_SYSTEM =
  "你是资深全渠道商家口碑管理专家，只输出 3 行回复方案倾向，每行严格为「标题：核心思路，适用场景」格式（中文冒号），不要总标题、不要序号、不要 Markdown 代码块、不要空行。";

/** 与最终回复一致的生成参数摘要，供方案倾向与语气/长度对齐 */
export type AdvisorReplySchemesGenerationContext = {
  category: string;
  toneLine: string;
  lengthLine: string;
};

export function buildAdvisorReplySchemesGenerationContext(input: {
  category: string;
  presetStyle: PresetStyle;
  customPersona: string | null;
  lengthPreference: LengthPreferenceBounds;
}): AdvisorReplySchemesGenerationContext {
  const tone =
    input.customPersona && input.customPersona.trim()
      ? input.customPersona.trim()
      : `（预设：${input.presetStyle}）\n${PRESET_STYLE_INSTRUCTIONS[input.presetStyle]}`;
  const len = input.lengthPreference;
  return {
    category: input.category,
    toneLine: tone,
    lengthLine: `${len.label}（每条 ${len.min}–${len.max} 个可见字符，含标点数字）`,
  };
}

/** 动态生成 3 条差异化回复方案倾向（无固定模板名称） */
export function buildAdvisorReplySchemesUserPrompt(
  ratingType: AdvisorRatingType,
  review: string,
  coreAnalysis: string,
  generationContext?: AdvisorReplySchemesGenerationContext | null,
  diversifyHint?: string | null
): string {
  let prompt = `你是资深全渠道商家口碑管理专家，请基于以下${ratingType}的核心问题/亮点分析，生成 3 条**完全不同**的回复方案倾向。

硬性要求：
1. 每条必须严格采用格式「标题：核心思路，适用场景」（使用中文冒号「：」；标题简短有力）。
2. 三条须在核心思路、切入角度、语气力度上有**明显区别**，禁止套话雷同、禁止三条仅换表述的重复。
3. 完全针对本次具体情境与分析，不使用固定公关话术模板。

【${ratingType}原文或情境】
${review}

【核心分析】
${coreAnalysis}`;

  if (generationContext) {
    prompt += `

【用户当前生成参数】（后续最终回复将按此执行，方案倾向需与之协调）
行业：${generationContext.category}
回复语气：
${generationContext.toneLine}
长度偏好：${generationContext.lengthLine}`;
  }

  if (diversifyHint?.trim()) {
    prompt += `

【本轮差异化】${diversifyHint.trim()}`;
  }

  prompt += `

只输出 3 条方案，每条单独一行，不要序号，不要空行，不要其他任何说明。`;

  return prompt;
}

/** @deprecated 使用 buildAdvisorReplySchemesUserPrompt */
export const buildAdvisorTendenciesUserPrompt = buildAdvisorReplySchemesUserPrompt;

/** @deprecated 使用 ADVISOR_REPLY_SCHEMES_SYSTEM */
export const ADVISOR_TENDENCIES_SYSTEM = ADVISOR_REPLY_SCHEMES_SYSTEM;

/** 解析模型返回的 3 条方案（每行一条） */
export function parseAdvisorTendencyLines(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const cleaned = lines.filter((s) => !/^[123][\.、．]\s*/.test(s));
  const out = cleaned.length >= 3 ? cleaned.slice(0, 3) : lines.slice(0, 3);
  return out;
}

export const ADVISOR_FINAL_REPLIES_SYSTEM = `你是资深全渠道商家口碑管理专家。必须严格按要求生成 3 条回复，且只输出一段合法 JSON，不要任何其他内容。固定结构：{"replies":["第一条","第二条","第三条"]}，数组恰好 3 条字符串。`;

export function buildAdvisorFinalUserPrompt(input: {
  ratingType: AdvisorRatingType;
  review: string;
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

  return `你是资深全渠道商家口碑管理专家，请结合以下信息生成 3 条差异化 ${input.ratingType} 回复：1.${input.ratingType} 原文：${input.review} 2. 核心分析：${input.coreAnalysis} 3. 用户选择的回复方案倾向：${input.prTendency} 4. 用户补充信息：${extra} 5. 行业：${input.category} 6. 回复语气：${tone} 7. 长度偏好：${lenLine}，要求严格遵循所选回复方案倾向、融入补充信息、三条回复差异化、不过度承诺、符合字数要求，只输出合法 JSON，结构为 {"replies":["第一条","第二条","第三条"]}。`;
}
