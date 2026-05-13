/**
 * Critic Agent — DeepSeek V3
 * 五维体检评分，使用详细评分标准
 * 使用 generateText + jsonrepair，避免 DeepSeek 工具调用模式 JSON 损坏
 */

"use server";

import { generateText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { MODELS, calcCost } from "@/lib/llm";
import type { CriticResult, TopicCard } from "@/store/types";

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

const PASS_THRESHOLD = 80;

const DimensionSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  risk: z.enum(["low", "mid", "high"]),
  reason: z.string(),
});

const CriticSchema = z.object({
  dimensions: z.array(DimensionSchema).min(5).max(5),
  totalScore: z.number().min(0).max(100),
  pass: z.boolean(),
  suggestions: z.array(z.string()),
});

export interface CriticAgentInput {
  topic: TopicCard;
  draft: string;
  round?: number;
}

export interface CriticAgentOutput extends CriticResult {
  tokens: number;
  cost: number;
}

export async function runCriticAgent(
  input: CriticAgentInput
): Promise<CriticAgentOutput> {
  const { topic, draft, round = 1 } = input;

  if (MOCK_MODE || !process.env.LLM_GATEWAY_URL) {
    return {
      dimensions: [
        { name: "AI味检测",   score: 72, risk: "mid", reason: "mock 模式" },
        { name: "事实风险",   score: 80, risk: "low", reason: "mock 模式" },
        { name: "营销风险",   score: 90, risk: "low", reason: "mock 模式" },
        { name: "标题党风险", score: 85, risk: "low", reason: "mock 模式" },
        { name: "答非所问",   score: 78, risk: "low", reason: "mock 模式" },
      ],
      totalScore: 81, pass: true,
      suggestions: ["mock 模式下无真实建议"],
      round, tokens: 0, cost: 0,
    };
  }

  const { text, usage } = await generateText({
    model: MODELS.critic,
    prompt: `你是知乎内容质量审核专家。对下方文章做五维体检。

⚠️ 核心原则：五个维度检测的是完全不同的问题，必须独立评分。
一篇文章完全可能：AI味极重（50分）但事实可靠（90分）且没有营销（98分）。
【禁止聚集】若你输出的5个分数全部落在同一20分区间（例如全部75-95），
视为未认真核查，必须重新逐条对照扣分点。

【选题】${topic.title}
【第 ${round} 轮体检】
【正文】
${draft.slice(0, 3000)}

━━ 评分流程 ━━
第一步：在 <analysis> 标签内，逐维度列出正文中找到的具体问题（引用原句），无问题写"无"。
第二步：根据找到的问题数量按扣分点区间算出各维度得分。
第三步：在 </analysis> 之后，只输出一个 JSON 对象，不要有任何其他文字。

━━ 五维扣分点 ━━

①AI味检测（起始100，每条扣5-10分）
· 「综上所述」「首先/其次/最后」机械连接词
· 排比过度、结构工整如范文模板
· 「不得不说」「在我看来」「我们可以发现」等AI高频词
· 段落长度极度均匀，无长短句变化
合格线：≥80

②事实风险（起始100，每条扣10-20分）
· 无来源绝对数据（「80%的人」）
· 案例/人物/时间明显错误
· 非黑即白的绝对化结论
· 术语使用错误或误导性简化
合格线：≥80

③营销风险（起始100，每条扣15-25分）
· 推荐产品/服务/课程/社群
· 「私信我」「看我主页」「关注我」
· 优惠券/链接/二维码描述
· 明显引流目的
合格线：≥85

④标题党风险（起始100，每条扣10-20分）
· 「震惊」「必看」「99%的人都错了」夸张词
· 标题与正文严重不符
· 开头制造过度焦虑「再不做就晚了」
· 提问标题但正文不回答
合格线：≥80

⑤答非所问（起始100，每条扣15-25分）
· 大量铺垫无关背景
· 只讲通用道理，无针对选题的具体分析
· 核心观点模糊，未回应选题问题
· 无关案例填充
合格线：≥80

━━ JSON 格式（<analysis>结束后紧接这个结构）━━
{"dimensions":[{"name":"AI味检测","score":55,"risk":"high","reason":"「首先」「其次」「最后」连用三次；「不得不说」出现2次；段落均为3-4行无节奏变化"},{"name":"事实风险","score":88,"risk":"low","reason":"无扣分点，数据均有限定语"},{"name":"营销风险","score":96,"risk":"low","reason":"无扣分点"},{"name":"标题党风险","score":73,"risk":"mid","reason":"开头「很多人都忽视」有轻微焦虑制造"},{"name":"答非所问","score":62,"risk":"mid","reason":"前两段大量铺垫背景，核心问题在第4段才出现"}],"totalScore":75,"pass":false,"suggestions":["删除首先/其次/最后，用具体内容衔接段落","开头焦虑句改为具体现象描述","压缩前两段背景，直接切入核心观点"]}

risk：①②④⑤ score≥80→low / 60-79→mid / <60→high；③ score≥85→low / 60-84→mid / <60→high
totalScore = 五维平均分（四舍五入）
pass：totalScore≥${PASS_THRESHOLD} 且无 high → true
suggestions：仅针对 mid/high 维度，2-3条可操作建议，不用英文双引号`,
  });

  const tokens = usage?.totalTokens ?? 0;
  const cost = calcCost("deepseek-chat", tokens);

  const afterAnalysis = text.includes("</analysis>")
    ? text.slice(text.indexOf("</analysis>") + "</analysis>".length)
    : text;
  const rawJson = afterAnalysis.slice(afterAnalysis.indexOf("{"), afterAnalysis.lastIndexOf("}") + 1);
  const repaired = jsonrepair(rawJson);
  const raw = CriticSchema.parse(JSON.parse(repaired));

  // 服务端重新计算，不依赖模型的数值
  const totalScore = Math.round(
    raw.dimensions.reduce((sum, d) => sum + d.score, 0) / raw.dimensions.length
  );
  const hasHigh = raw.dimensions.some(d => d.risk === "high");
  const pass = totalScore >= PASS_THRESHOLD && !hasHigh;

  return { ...raw, totalScore, pass, round, tokens, cost };
}

/**
 * Critic 自反馈循环：不达标时自动重写 + 重评，最多 3 轮
 */
export async function runCriticLoop(input: {
  topic: TopicCard;
  draft: string;
  onRoundComplete?: (round: number, result: CriticAgentOutput) => void;
}): Promise<{ draft: string; criticResult: CriticAgentOutput }> {
  let { draft } = input;
  let criticResult: CriticAgentOutput | null = null;

  for (let round = 1; round <= 3; round++) {
    criticResult = await runCriticAgent({ topic: input.topic, draft, round });
    input.onRoundComplete?.(round, criticResult);
    if (criticResult.pass) break;
    if (round < 3) {
      draft = await rewriteDraft({
        originalDraft: draft,
        suggestions: criticResult.suggestions,
        topic: input.topic,
      });
    }
  }

  return { draft, criticResult: criticResult! };
}

async function rewriteDraft(params: {
  originalDraft: string;
  suggestions: string[];
  topic: TopicCard;
}): Promise<string> {
  if (MOCK_MODE || !process.env.LLM_GATEWAY_URL) {
    return params.originalDraft + "\n\n（已根据反馈优化）";
  }
  const { generateText } = await import("ai");
  const { text } = await generateText({
    model: MODELS.draft,
    prompt: `根据以下建议对文章针对性改写，保持核心观点和结构不变，直接输出全文：

【建议】
${params.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

【原文】
${params.originalDraft}`,
    maxTokens: 2000,
  });
  return text;
}
