/** 与主页面识图一致：类型、大小、请求体 */

export const EXTRACT_REVIEW_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const EXTRACT_REVIEW_ACCEPT_IMAGES =
  "image/jpeg,image/png,image/webp,image/gif";

/** 长边上限，兼顾评价截图文字清晰度与上传/推理体积 */
const VISION_MAX_LONG_EDGE = 1400;
const VISION_JPEG_QUALITY = 0.88;

function dataUrlToBase64Payload(dataUrl: string): {
  mimeType: string;
  imageBase64: string;
} {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    throw new Error("图片编码失败，请换一张重试。");
  }
  const header = dataUrl.slice(0, comma);
  const imageBase64 = dataUrl.slice(comma + 1).trim();
  const hm = /^data:([^;]+);base64$/i.exec(header);
  if (!hm || !imageBase64) {
    throw new Error("图片编码失败，请换一张重试。");
  }
  return {
    mimeType: hm[1].trim().toLowerCase(),
    imageBase64,
  };
}

/**
 * 将截图压成 JPEG 再上传，减少 Base64 体积与方舟识图耗时（尤其网页/手机弱网）。
 * 解码失败时返回 null，由调用方回退为原始文件编码。
 */
async function shrinkImageFileForVision(
  file: File
): Promise<{ mimeType: string; imageBase64: string } | null> {
  if (typeof createImageBitmap !== "function") return null;
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return null;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const maxDim = Math.max(w, h);
    if (maxDim > VISION_MAX_LONG_EDGE) {
      const scale = VISION_MAX_LONG_EDGE / maxDim;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", VISION_JPEG_QUALITY);
    });
    if (!blob || blob.size === 0) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("读取压缩图失败。"));
      };
      reader.onerror = () => reject(new Error("读取压缩图失败。"));
      reader.readAsDataURL(blob);
    });

    return dataUrlToBase64Payload(dataUrl);
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

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

function approxBase64DecodedBytes(imageBase64: string): number {
  const len = imageBase64.length;
  if (len < 4) return 0;
  let padding = 0;
  if (imageBase64.endsWith("==")) padding = 2;
  else if (imageBase64.endsWith("=")) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

export async function requestExtractReviewFromImage(
  file: File
): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("当前网络不可用，请连接网络后重试。");
  }

  let mimeType: string;
  let imageBase64: string;
  const shrunk = await shrinkImageFileForVision(file);
  if (shrunk) {
    ({ mimeType, imageBase64 } = shrunk);
  } else {
    ({ mimeType, imageBase64 } = await readFileAsBase64Payload(file));
  }

  if (approxBase64DecodedBytes(imageBase64) > EXTRACT_REVIEW_MAX_IMAGE_BYTES) {
    throw new Error("图片仍过大，请裁剪评价区域或换一张较小的截图。");
  }

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
