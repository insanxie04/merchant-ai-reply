/** 评价文本 → 好评/中评/差评（仅 JSON 输出） */
export const RATING_CLASSIFY_SYSTEM = `你是美团顾客评价文本分类助手。根据评价原文判断情感倾向，只输出一段合法 JSON，不要 Markdown、不要代码围栏、不要解释。

字段 ratingType 必须是以下之一（严格字面）：好评、中评、差评
- 好评：整体满意、推荐、表扬为主
- 中评：褒贬兼有、一般、凑合、有小问题但非激烈投诉
- 差评：明显不满、投诉、要求退款/重做、强烈负面

输出格式示例：{"ratingType":"中评"}`;

export function buildRatingClassifyUserPrompt(review: string): string {
  return `请判断下列顾客评价属于「好评」「中评」「差评」中的哪一种，只输出 JSON 对象：\n\n${review}`;
}
