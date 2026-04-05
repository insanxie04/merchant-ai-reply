/** 与主页面识图一致：类型、大小、请求体 */

export const EXTRACT_REVIEW_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const EXTRACT_REVIEW_ACCEPT_IMAGES =
  "image/jpeg,image/png,image/webp,image/gif";

export function readFileAsBase64Payload(file: File): Promise<{
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

export async function requestExtractReviewFromImage(
  file: File
): Promise<string> {
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
