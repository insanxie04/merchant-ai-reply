import { NextResponse } from "next/server";
import { endpointIdConfigError } from "@/lib/ark-endpoint-id";
import { DEFAULT_BASE, mapArkErrorStatus } from "@/lib/ark-errors";
import {
  buildRatingClassifyUserPrompt,
  RATING_CLASSIFY_SYSTEM,
} from "@/lib/meituan-rating-classify-prompt";
import { parseRatingClassification } from "@/lib/parse-rating-classification";

const MAX_REVIEW_LEN = 8000;

export async function POST(request: Request) {
  const apiKey = process.env.DOUBAO_API_KEY?.trim();
  const modelId = process.env.DOUBAO_MODEL_ID?.trim();
  const baseUrl = (
    process.env.DOUBAO_API_BASE_URL?.trim() || DEFAULT_BASE
  ).replace(/\/$/, "");

  if (!apiKey || !modelId) {
    return NextResponse.json(
      {
        error:
          "服务未配置：请在项目根目录 .env.local 中设置 DOUBAO_API_KEY 与 DOUBAO_MODEL_ID。",
      },
      { status: 503 }
    );
  }

  const endpointErr = endpointIdConfigError(modelId, "DOUBAO_MODEL_ID");
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
  const review = typeof body.review === "string" ? body.review.trim() : "";

  if (!review) {
    return NextResponse.json({ error: "评价内容不能为空。" }, { status: 400 });
  }
  if (review.length > MAX_REVIEW_LEN) {
    return NextResponse.json(
      { error: `评价内容过长（超过 ${MAX_REVIEW_LEN} 字），请精简后重试。` },
      { status: 400 }
    );
  }

  const userPrompt = buildRatingClassifyUserPrompt(review);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: RATING_CLASSIFY_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 80,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return NextResponse.json(
        { error: "请求超时，请检查网络后重试。" },
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
          modelHint: "DOUBAO_MODEL_ID（推理接入点 ID）",
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
    const ratingType = parseRatingClassification(content);
    return NextResponse.json({ ratingType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析分类结果失败，请重试。";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
