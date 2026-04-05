/** 统计可见字符数（含中文、标点、emoji 等 Unicode 标量） */
export function countVisualChars(s: string): number {
  return [...s.trim()].length;
}

/**
 * 从模型输出中解析 {"replies":["a","b","c"]}。
 * 长度偏好仅在提示词中引导模型，此处不做字数区间校验，避免因模型略短/略长导致整次生成失败。
 */
export function parseRepliesPayload(content: string): string[] {
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
    !("replies" in parsed) ||
    !Array.isArray((parsed as { replies: unknown }).replies)
  ) {
    throw new Error("模型返回格式异常（缺少 replies 数组），请重试。");
  }

  const replies = (parsed as { replies: unknown[] }).replies.map((item) =>
    String(item).trim()
  );

  if (replies.length !== 3) {
    throw new Error("模型应返回恰好 3 条回复，请重试。");
  }

  if (replies.some((r) => r.length === 0)) {
    throw new Error("模型返回了空回复，请重试。");
  }

  return replies;
}
