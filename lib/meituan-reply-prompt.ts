/** 五种预设回复风格 → 模型指令要点（用于【回复语气】） */
export const PRESET_STYLE_INSTRUCTIONS: Record<
  | "亲切热情"
  | "专业正式"
  | "幽默风趣"
  | "简洁干练"
  | "真诚走心",
  string
> = {
  亲切热情:
    "语气温暖亲切，多用语气词和表情符号，像和朋友聊天一样。",
  专业正式:
    "语言规范严谨，用词得体，适合注重品牌形象的商家。",
  幽默风趣:
    "语言轻松有趣，适当使用网络流行语，能化解差评的尴尬。",
  简洁干练:
    "用最少的话表达核心意思，不啰嗦，适合快节奏的餐饮、零售商家。",
  真诚走心:
    "语气诚恳，多用第一人称，表达真实的感谢或歉意，能打动用户。",
};

export type PresetStyle = keyof typeof PRESET_STYLE_INSTRUCTIONS;

export const PRESET_STYLE_LIST = Object.keys(
  PRESET_STYLE_INSTRUCTIONS
) as PresetStyle[];

/** 全渠道商家口碑回复 · 系统提示词 */
export const GENERAL_MERCHANT_REPLY_SYSTEM_PROMPT = `你是资深「全渠道商家口碑管理」专家，长期协助各行业门店，撰写美团、大众点评、抖音、小红书、淘宝、京东等全平台的公开顾客评价回复。

## 核心定位
- 回复适用于所有主流本地生活及电商平台，读者是顾客与潜在顾客，目标是提升满意度、塑造品牌形象、促进转化。
- 你是商家的专属口碑管家，回复要像真人在说话，自然真诚，避免刻板套话。

## 必须严格遵循的参数（硬绑定，禁止自行修改）
1. 【行业】：{商家品类}，请使用对应行业的专属话术和场景化表达。
2. 【回复语气】：{回复语气}，严格按照该语气生成回复；若为自定义人设，完全遵循用户输入的人设描述。
3. 【评价类型】：{评价类型}，这是唯一合法类型，**禁止**根据评价原文语气自行改判。
4. 【长度偏好】：{长度偏好}，严格控制每条回复的字数在对应范围内。
5. 【追加要求】：{追加要求}，若有内容，必须作为最高优先级指令执行；若无内容，忽略此参数。

以上五项的实际取值以用户消息中的对应段落为准，**禁止**根据评价原文自行修改、覆盖或重新推断任一参数。

## 按评价类型的回复策略
- **好评**：热情感谢+呼应具体细节+再次欢迎。必须引用顾客原文中的1-2个具体关键词，传递"被看见"的感觉；绝对不能出现道歉或改进类表述。
- **中评**：真诚安抚+承认不足+明确改进态度。虚心接纳反馈，给出具体可感知的改进方向；不辩解、不甩锅、不过度谢罪。
- **差评**：先诚恳道歉+理解顾客感受+针对性解决方案。每条必须先道歉，再针对具体问题给出改进措施；先承担责任，不甩锅给员工或第三方。

## 内容质量硬性要求
1. **绝对差异化**：三条回复在切入角度、语气、表述方式上必须明显不同，禁止模板化重复。
   - 示例：第一条从"道歉+具体问题"切入，第二条从"品牌理念+改进决心"切入，第三条从"补救措施+再次邀请"切入。
2. **禁止过度承诺**：不编造不存在的优惠，不做无法兑现的保证；涉及补偿时用语留有余地，如"我们会尽快与您联系核实处理"。
3. **禁止敏感内容**：不使用"绝对""最好""第一"等极限词，不使用任何违法违规或违背公序良俗的表述。
4. **针对性强**：所有回复必须针对顾客评价原文的具体内容撰写，禁止使用通用模板句。

## 输出形式（必须严格遵守）
- 只输出一段合法 JSON，不要任何其他内容。
- 固定结构：{"replies":["第一条","第二条","第三条"]}
- 数组必须恰好 3 条字符串，每条字数严格符合【长度偏好】要求。`;

export type LengthPreferenceBounds = { min: number; max: number; label: string };

export function buildMeituanReplyUserPrompt(input: {
  review: string;
  category: string;
  ratingType: string;
  customPersona: string | null;
  presetStyle: PresetStyle;
  extraRequirements?: string | null;
  lengthPreference: LengthPreferenceBounds;
}): string {
  const extraRaw = input.extraRequirements?.trim() || "";
  const extraBlock = extraRaw
    ? `【追加要求】（**最高优先级**：若与人设、语气、行业等任意内容冲突，必须以本段为准；三条回复均须落实）
"""
${extraRaw}
"""

`
    : "【追加要求】（无）\n\n";

  const personaGuard = extraRaw
    ? "在不与上述【追加要求】冲突的前提下，"
    : "";

  const toneBlock =
    input.customPersona && input.customPersona.trim()
      ? `【回复语气】（${personaGuard}**自定义人设**，须完全按下列描述撰写三条回复）
"""
${input.customPersona.trim()}
"""
`
      : `【回复语气】（预设：${input.presetStyle}${extraRaw ? "；须服从上述【追加要求】" : ""}）
${PRESET_STYLE_INSTRUCTIONS[input.presetStyle]}
`;

  const len = input.lengthPreference;
  const lengthBlock = `【长度偏好】${len.label}（**每条**回复须控制在 ${len.min}–${len.max} 个汉字；以可见字符计，含标点数字，不含 JSON 转义符）`;

  const ratingWriteRule =
    input.ratingType === "好评"
      ? "本任务【评价类型】为「好评」：三条须**仅**热情感谢+细节呼应，禁止道歉或改进主线表述。"
      : input.ratingType === "中评"
        ? "本任务【评价类型】为「中评」：三条须**仅**安抚+改进态度，禁止纯好评吹捧或差评式过度谢罪、甩锅。"
        : "本任务【评价类型】为「差评」：三条须**仅**先道歉再解决方案，禁止写成好评或轻描淡写。";

  return `请根据以下信息生成 3 条可直接复制到各平台评价区发布的回复。

${extraBlock}${lengthBlock}

【行业】${input.category}
【评价类型】${input.ratingType}（**唯一依据**：策略口径必须与本字段一致，**禁止**根据【顾客评价原文】改判类型。）
${toneBlock}
【顾客评价原文】
"""
${input.review}
"""

${ratingWriteRule}
要求：三条各有差异；贴合原文细节；每条字数严格落在【长度偏好】范围内。请输出 JSON：{"replies":["...","...","..."]}`;
}
