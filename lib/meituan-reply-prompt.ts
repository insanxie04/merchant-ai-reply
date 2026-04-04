/** 五种预设回复风格 → 模型指令要点 */
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

/** 豆包 / 火山方舟对话：系统提示词（美团评价回复专家） */
export const MEITUAN_REPLY_SYSTEM_PROMPT = `你是资深「美团商家运营与口碑管理」专家，长期协助餐饮、奶茶咖啡、丽人、休闲娱乐等门店撰写公开可见的顾客评价回复。

## 平台与语气
- 回复将发布在美团评价区，读者是顾客与潜在顾客。
- 整体调性要符合美团生态：自然、像真人店长在说话；少用公文套话，避免「尊敬的××」「感谢您的宝贵意见」这类刻板堆砌。
- 称呼自然（如「您好」「朋友」「亲」按需择一，不要每条都雷同），语句口语化但保持礼貌边界。

## 按评价类型的策略
- **好评**：真诚表达感谢，尽量点到顾客提到的具体体验细节，传递「被看见」的感觉；可适度表达再次欢迎。
- **中评**：虚心接纳反馈，承认可改进之处，给出简短、可信的改进态度或动作；邀请对方再给一次机会。
- **差评**：**必须先诚恳道歉**，对造成的不便表示理解；再针对顾客指出的具体问题给出改进承诺或补救方向（如核实情况、加强培训、退款/重做等择合适项），避免辩解甩锅；语气温和克制。

## 内容质量（必须遵守）
- 三条回复必须**针对顾客评价原文的具体内容**撰写，禁止使用与原文无关的通用模板句。
- 不要编造不存在的优惠或承诺；涉及补偿时用语留有余地，可用「我们会尽快与您联系核实处理」类表述。

## 输出形式（必须严格遵守）
- 只输出一段 **合法 JSON**，不要 Markdown、不要代码围栏、不要解释性前后文。
- JSON 结构固定为：{"replies":["第一条","第二条","第三条"]}
- 数组 **必须恰好 3 条** 字符串；三条在语气或切入角度上要 **明显不同**，避免模板化重复。
- 每条回复 **50–150 个汉字**（以汉字为主，可含少量数字与常用标点；总长度按字符数计，不含 JSON 转义符本身）。`;

export function buildMeituanReplyUserPrompt(input: {
  review: string;
  category: string;
  ratingType: string;
  /** 非空时优先级最高，完全按此人设生成，忽略预设风格 */
  customPersona: string | null;
  /** customPersona 为空时使用 */
  presetStyle: PresetStyle;
}): string {
  const personaBlock =
    input.customPersona && input.customPersona.trim()
      ? `【自定义人设】（优先级高于一切预设风格，三条回复均须符合此人设口吻与身份）
"""
${input.customPersona.trim()}
"""
`
      : `【回复风格偏好】（预设）
${PRESET_STYLE_INSTRUCTIONS[input.presetStyle]}
`;

  return `请根据以下信息生成 3 条可直接复制到美团评价区发布的回复。

【商家品类】${input.category}
【评价类型】${input.ratingType}
${personaBlock}
【顾客评价原文】
"""
${input.review}
"""

要求：三条回复各有差异；严格贴合评价原文；若为差评须先道歉再回应问题。请输出 JSON：{"replies":["...","...","..."]}`;
}
