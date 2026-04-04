/** 方舟 OpenAI 兼容接口里 `model` 应填「推理接入点 ID」，一般为 ep- 前缀 */
export function isLikelyArkEndpointId(id: string): boolean {
  return id.trim().toLowerCase().startsWith("ep-");
}

/**
 * 若不像接入点 ID，返回说明文案；否则返回 null。
 * @param envVarName 例如 DOUBAO_MODEL_ID
 */
export function endpointIdConfigError(
  id: string,
  envVarName: string
): string | null {
  const t = id.trim();
  if (!t) return null;
  if (isLikelyArkEndpointId(t)) return null;
  return (
    `${envVarName} 须填火山方舟控制台「在线推理 → 推理接入点」的 ID（以 ep- 开头），` +
    `不要填模型广场里的模型名（例如 doubao-1.5-vision-pro-xxx）。请选中对应视觉模型后创建接入点，再复制接入点 ID 到 .env.local。`
  );
}
