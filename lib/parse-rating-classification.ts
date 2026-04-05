const ALLOWED = new Set(["好评", "中评", "差评"]);

export type ParsedRatingType = "好评" | "中评" | "差评";

/** 从模型输出中解析 {"ratingType":"好评"|"中评"|"差评"} */
export function parseRatingClassification(content: string): ParsedRatingType {
  const raw = content.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice) as unknown;
  } catch {
    throw new Error("模型返回内容无法解析为 JSON，请重试。");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { ratingType?: unknown }).ratingType !== "string"
  ) {
    throw new Error("模型返回格式异常（缺少 ratingType），请重试。");
  }

  const ratingType = (parsed as { ratingType: string }).ratingType.trim();
  if (!ALLOWED.has(ratingType)) {
    throw new Error("模型返回的评价类型无效，请重试。");
  }

  return ratingType as ParsedRatingType;
}
