import { NextResponse } from "next/server";
import { endpointIdConfigError } from "@/lib/ark-endpoint-id";
import { DEFAULT_BASE, mapArkErrorStatus } from "@/lib/ark-errors";
import {
  ADVISOR_CORE_ANALYSIS_SYSTEM,
  buildAdvisorCoreAnalysisUserPrompt,
  type AdvisorRatingType,
} from "@/lib/bad-review-advisor";

const MAX_ANALYSIS_LEN = 400;

function isAdvisorRatingType(s: string): s is AdvisorRatingType {
  return s === "好评" || s === "中评" || s === "差评";
}

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
  const ratingTypeRaw =
    typeof body.ratingType === "string" ? body.ratingType.trim() : "";
  if (!review) {
    return NextResponse.json({ error: "评价原文不能为空。" }, { status: 400 });
  }
  if (!isAdvisorRatingType(ratingTypeRaw)) {
    return NextResponse.json({ error: "评价类型无效。" }, { status: 400 });
  }

  const userContent = buildAdvisorCoreAnalysisUserPrompt(ratingTypeRaw, review);

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
          { role: "system", content: ADVISOR_CORE_ANALYSIS_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.45,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return NextResponse.json(
        { error: "请求超时，请检查网络后重试。" },
        { status: 504 }
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
      { error: "模型未返回有效分析内容，请重试。" },
      { status: 502 }
    );
  }

  let analysis = content.trim();
  if (analysis.length > MAX_ANALYSIS_LEN) {
    analysis = analysis.slice(0, MAX_ANALYSIS_LEN);
  }

  return NextResponse.json({ analysis });
}
