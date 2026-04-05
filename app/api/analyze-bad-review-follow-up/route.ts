import { NextResponse } from "next/server";
import { endpointIdConfigError } from "@/lib/ark-endpoint-id";
import { DEFAULT_BASE, mapArkErrorStatus } from "@/lib/ark-errors";
import type { AdvisorRatingType } from "@/lib/bad-review-advisor";
import {
  ADVISOR_FOLLOW_UP_CORE_ANALYSIS_SYSTEM,
  buildAdvisorFollowUpCoreAnalysisUserPrompt,
} from "@/lib/follow-up-prompts";

const MAX_ANALYSIS_LEN = 400;

function isAdvisorRatingType(s: string): s is AdvisorRatingType {
  return s === "好评" || s === "中评" || s === "差评";
}

/** 兼容旧客户端：未传 ratingType 时视为差评 */
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
  const originalReview =
    typeof body.originalReview === "string" ? body.originalReview.trim() : "";
  const lastMerchantReply =
    typeof body.lastMerchantReply === "string"
      ? body.lastMerchantReply.trim()
      : "";
  const buyerFollowUp =
    typeof body.buyerFollowUp === "string" ? body.buyerFollowUp.trim() : "";
  const rtRaw =
    typeof body.ratingType === "string" ? body.ratingType.trim() : "差评";
  const ratingType: AdvisorRatingType = isAdvisorRatingType(rtRaw)
    ? rtRaw
    : "差评";

  if (!originalReview || !buyerFollowUp) {
    return NextResponse.json({ error: "原评价与买家追评不能为空。" }, { status: 400 });
  }

  const userContent = buildAdvisorFollowUpCoreAnalysisUserPrompt({
    ratingType,
    originalReview,
    lastMerchantReply: lastMerchantReply || "（无）",
    buyerFollowUp,
  });

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
          { role: "system", content: ADVISOR_FOLLOW_UP_CORE_ANALYSIS_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.45,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
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
