const DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3";

export { DEFAULT_BASE };

type ArkErrorBody = {
  error?: { message?: string; code?: string; type?: string };
  message?: string;
};

/** 方舟返回的英文错误转中文说明（识图场景） */
function visionFriendlyMessage(apiMessage: string): string | null {
  const t = apiMessage.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (
    low.includes("multi-modal") ||
    low.includes("multimodal") ||
    low.includes("multi modal") ||
    low.includes("multimodal messages") ||
    (low.includes("image") &&
      (low.includes("not support") ||
        low.includes("unsupported") ||
        low.includes("does not support")))
  ) {
    return (
      "当前推理接入点不支持图片输入（多为纯文本模型）。请在火山方舟控制台为「支持多模态/视觉」的模型新建推理接入点，在 .env.local 中设置 DOUBAO_VISION_MODEL_ID 为该接入点 ID；生成文字回复仍可继续使用原来的 DOUBAO_MODEL_ID。"
    );
  }
  return null;
}

/** 将方舟 HTTP 状态与响应体映射为用户可读中文说明 */
export function mapArkErrorStatus(
  status: number,
  bodyText: string,
  options?: { modelHint?: string; visionContext?: boolean }
): string {
  let apiMessage = "";
  try {
    const j = JSON.parse(bodyText) as ArkErrorBody;
    apiMessage = j.error?.message ?? j.message ?? "";
  } catch {
    /* ignore */
  }

  const modelHint =
    options?.modelHint ??
    "DOUBAO_MODEL_ID（推理接入点 ID）";

  if (options?.visionContext) {
    const friendly = visionFriendlyMessage(apiMessage);
    if (friendly) return friendly;
  }

  const lowMsg = apiMessage.toLowerCase();
  if (
    lowMsg.includes("does not exist") &&
    (lowMsg.includes("endpoint") || lowMsg.includes("model"))
  ) {
    return (
      "方舟返回：该模型或接入点不存在，或当前密钥无权限。请确认 .env 中填写的是「推理接入点 ID」（以 ep- 开头），而不是模型目录名称（如 doubao-xxx）；并在控制台核对 API Key 权限、接入点状态与区域 Base URL 是否一致。"
    );
  }

  if (status === 401) {
    return "API 密钥无效或未授权，请检查 .env.local 中的 DOUBAO_API_KEY。";
  }
  if (status === 403) {
    return "没有访问该模型或推理接入点的权限，请在火山方舟控制台核对开通状态与模型 ID。";
  }
  if (status === 429) {
    return "请求过于频繁，请稍后再试。";
  }
  if (status === 400 || status === 404) {
    return (
      apiMessage ||
      `请求参数或模型接入点有误，请确认 ${modelHint} 是否正确，且该接入点支持当前能力（如多模态识图需使用视觉模型接入点）。`
    );
  }
  if (status >= 500) {
    return "豆包服务暂时不可用，请稍后重试。";
  }
  return apiMessage || `接口返回错误（HTTP ${status}），请稍后重试。`;
}
