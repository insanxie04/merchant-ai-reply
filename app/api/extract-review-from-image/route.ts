import { NextResponse } from "next/server";
import { endpointIdConfigError } from "@/lib/ark-endpoint-id";
import { DEFAULT_BASE, mapArkErrorStatus } from "@/lib/ark-errors";
import {
  MEITUAN_VISION_EXTRACT_SYSTEM,
  MEITUAN_VISION_EXTRACT_USER,
} from "@/lib/meituan-vision-extract-prompt";
import { parseReviewExtraction } from "@/lib/parse-review-extraction";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const VISION_MODEL_HINT =
  "DOUBAO_VISION_MODEL_ID 或 DOUBAO_MODEL_ID（须为支持图片输入的视觉推理接入点）";

export async function POST(request: Request) {
  const apiKey = process.env.DOUBAO_API_KEY?.trim();
  const textModelId = process.env.DOUBAO_MODEL_ID?.trim();
  const visionModelId =
    process.env.DOUBAO_VISION_MODEL_ID?.trim() || textModelId;
  const baseUrl = (
    process.env.DOUBAO_API_BASE_URL?.trim() || DEFAULT_BASE
  ).replace(/\/$/, "");

  if (!apiKey || !visionModelId) {
    return NextResponse.json(
      {
        error:
          "服务未配置：请在 .env.local 中设置 DOUBAO_API_KEY，并配置支持识图的接入点（DOUBAO_VISION_MODEL_ID，或与 DOUBAO_MODEL_ID 共用同一多模态接入点）。",
      },
      { status: 503 }
    );
  }

  const visionEnvName = process.env.DOUBAO_VISION_MODEL_ID?.trim()
    ? "DOUBAO_VISION_MODEL_ID"
    : "DOUBAO_MODEL_ID";
  const endpointErr = endpointIdConfigError(visionModelId, visionEnvName);
  if (endpointErr) {
    return NextResponse.json({ error: endpointErr }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效的 JSON。" }, { status: 400 });
  }

  const body = json as Record<string, unknown>;
  const mimeType =
    typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const imageBase64 =
    typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";

  if (!imageBase64) {
    return NextResponse.json({ error: "请提供图片数据（imageBase64）。" }, { status: 400 });
  }
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      {
        error: "仅支持 JPEG、PNG、WebP、GIF 图片，请检查 mimeType。",
      },
      { status: 400 }
    );
  }

  let binary: Buffer;
  try {
    binary = Buffer.from(imageBase64, "base64");
  } catch {
    return NextResponse.json({ error: "图片 Base64 数据无效。" }, { status: 400 });
  }

  if (binary.length === 0) {
    return NextResponse.json({ error: "图片数据为空。" }, { status: 400 });
  }
  if (binary.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `图片过大（超过 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB），请压缩后重试。` },
      { status: 400 }
    );
  }

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: visionModelId,
        messages: [
          { role: "system", content: MEITUAN_VISION_EXTRACT_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: MEITUAN_VISION_EXTRACT_USER },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return NextResponse.json(
        { error: "识图请求超时，请检查网络后重试。" },
        { status: 504 }
      );
    }
    if (err.cause?.code === "ENOTFOUND" || err.cause?.code === "ECONNREFUSED") {
      return NextResponse.json(
        { error: "网络连接失败，请检查网络或稍后再试。" },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "网络异常，请稍后重试。" },
      { status: 502 }
    );
  }

  const text = await res.text();

  if (!res.ok) {
    const clientStatus =
      res.status === 401
        ? 401
        : res.status === 403
          ? 403
          : res.status === 429
            ? 429
            : res.status >= 500
              ? 502
              : 400;
    return NextResponse.json(
      {
        error: mapArkErrorStatus(res.status, text, {
          modelHint: VISION_MODEL_HINT,
          visionContext: true,
        }),
      },
      { status: clientStatus }
    );
  }

  let data: {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return NextResponse.json(
      { error: "接口返回了非 JSON 数据，请稍后重试。" },
      { status: 502 }
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "模型未返回有效文本，请重试。" },
      { status: 502 }
    );
  }

  try {
    const review = parseReviewExtraction(content);
    return NextResponse.json({ review });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析识别结果失败，请重试。";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
