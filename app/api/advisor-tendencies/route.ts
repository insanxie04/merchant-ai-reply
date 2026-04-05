import { NextResponse } from "next/server";
import { endpointIdConfigError } from "@/lib/ark-endpoint-id";
import { DEFAULT_BASE, mapArkErrorStatus } from "@/lib/ark-errors";
import {
  ADVISOR_REPLY_SCHEMES_SYSTEM,
  buildAdvisorReplySchemesGenerationContext,
  buildAdvisorReplySchemesUserPrompt,
  parseAdvisorTendencyLines,
  type AdvisorRatingType,
} from "@/lib/bad-review-advisor";
import { CATEGORY_PRESET_SET } from "@/lib/merchant-categories";
import { lengthBounds, LENGTH_PREFERENCE_IDS } from "@/lib/length-preference";
import { PRESET_STYLE_LIST, type PresetStyle } from "@/lib/meituan-reply-prompt";

const MAX_CUSTOM_CATEGORY_LEN = 50;
const PRESET_STYLES = new Set<string>(PRESET_STYLE_LIST);
const LENGTH_PREF_SET = new Set<string>(LENGTH_PREFERENCE_IDS);

function isPresetStyle(s: string): s is PresetStyle {
  return PRESET_STYLES.has(s);
}

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
  const coreAnalysis =
    typeof body.coreAnalysis === "string" ? body.coreAnalysis.trim() : "";
  const ratingTypeRaw =
    typeof body.ratingType === "string" ? body.ratingType.trim() : "";

  if (!review) {
    return NextResponse.json({ error: "评价原文不能为空。" }, { status: 400 });
  }
  if (!coreAnalysis) {
    return NextResponse.json({ error: "核心分析不能为空。" }, { status: 400 });
  }
  if (!isAdvisorRatingType(ratingTypeRaw)) {
    return NextResponse.json({ error: "评价类型无效。" }, { status: 400 });
  }

  const categoryRaw =
    typeof body.category === "string" ? body.category.trim() : "";
  const styleRaw = typeof body.style === "string" ? body.style.trim() : "";
  const customPersona =
    typeof body.customPersona === "string" ? body.customPersona.trim() : "";
  if (customPersona.length > 100) {
    return NextResponse.json(
      { error: "自定义人设内容不能超过 100 字。" },
      { status: 400 }
    );
  }
  const lengthPreferenceRaw =
    typeof body.lengthPreference === "string"
      ? body.lengthPreference.trim()
      : "";
  const diversifyNonceRaw =
    typeof body.diversifyNonce === "string"
      ? body.diversifyNonce.trim().slice(0, 64)
      : "";

  let generationContext = null;
  if (categoryRaw) {
    if (!isPresetStyle(styleRaw)) {
      return NextResponse.json(
        { error: "回复语气（风格）无效。" },
        { status: 400 }
      );
    }
    if (!lengthPreferenceRaw || !LENGTH_PREF_SET.has(lengthPreferenceRaw)) {
      return NextResponse.json({ error: "长度偏好无效。" }, { status: 400 });
    }
    if (CATEGORY_PRESET_SET.has(categoryRaw)) {
      /* ok */
    } else if (
      categoryRaw.length <= MAX_CUSTOM_CATEGORY_LEN &&
      !/[\r\n]/.test(categoryRaw)
    ) {
      /* ok */
    } else {
      return NextResponse.json({ error: "商家品类无效。" }, { status: 400 });
    }
    const lenMeta = lengthBounds(lengthPreferenceRaw);
    generationContext = buildAdvisorReplySchemesGenerationContext({
      category: categoryRaw,
      presetStyle: styleRaw,
      customPersona: customPersona || null,
      lengthPreference: lenMeta,
    });
  }

  const diversifyHint = diversifyNonceRaw
    ? `批次标识 ${diversifyNonceRaw}：请与常见套路及历史输出明显区分，三条之间差异最大化。`
    : null;

  const userContent = buildAdvisorReplySchemesUserPrompt(
    ratingTypeRaw,
    review,
    coreAnalysis,
    generationContext,
    diversifyHint
  );

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
          { role: "system", content: ADVISOR_REPLY_SCHEMES_SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.78,
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
      { error: "模型未返回有效回复方案内容，请重试。" },
      { status: 502 }
    );
  }

  const tendencies = parseAdvisorTendencyLines(content.trim());
  if (tendencies.length !== 3) {
    return NextResponse.json(
      { error: "回复方案解析失败，请重试。" },
      { status: 502 }
    );
  }

  return NextResponse.json({ tendencies });
}
