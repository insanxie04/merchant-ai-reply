/** 从模型输出中解析 {"review":"..."} */
export function parseReviewExtraction(content: string): string {
  const raw = content.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice) as unknown;
  } catch {
    throw new Error("识别结果无法解析，请换一张更清晰的美团评价截图重试。");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("review" in parsed)
  ) {
    throw new Error("识别结果格式异常，请重试。");
  }

  const review = String((parsed as { review: unknown }).review).trim();
  if (!review) {
    throw new Error(
      "未能从图片中识别出评价文字，请上传包含评价正文的美团评价截图。"
    );
  }

  const MAX = 8000;
  return review.length > MAX ? review.slice(0, MAX) : review;
}
