/**
 * Outline Agent — DeepSeek V3
 * 基于选题 + 立场 + 观点地图，生成知乎专属大纲
 * 使用 generateText + jsonrepair，避免 DeepSeek 工具调用模式 JSON 损坏
 */

"use server";

import { generateText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { MODELS, calcCost } from "@/lib/llm";
import type { Outline, TopicCard, InsightNode } from "@/store/types";

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

const OutlineSchema = z.object({
  hook: z.string(),
  corePoint: z.string(),
  arguments: z.array(z.string()).min(2),
  interaction: z.string(),
});

export interface OutlineAgentInput {
  topic: TopicCard;
  stance: string;
  insightNodes: InsightNode[];
}

export interface OutlineAgentOutput {
  outline: Outline;
  tokens: number;
  cost: number;
}

const FALLBACK_OUTLINE: Outline = {
  hook: "加载中，请稍候…",
  corePoint: "",
  arguments: [],
  interaction: "",
};

export async function runOutlineAgent(
  input: OutlineAgentInput
): Promise<OutlineAgentOutput> {
  const { topic, stance, insightNodes } = input;

  if (MOCK_MODE || !process.env.LLM_GATEWAY_URL) {
    // mock 模式：生成简易占位大纲
    return {
      outline: {
        hook: `当所有人都在讨论「${topic.title}」时，大多数人忽略了最关键的一点。`,
        corePoint: topic.angle,
        arguments: [
          "事实层：从真实数据和案例出发，建立认知锚点。",
          "逻辑层：厘清因果链，解释为何会这样。",
          "价值层：这件事为什么对你我都重要。",
        ],
        interaction: "你在这件事上踩过哪些坑？评论区聊聊。",
      },
      tokens: 0,
      cost: 0,
    };
  }

  const insightSummary = insightNodes
    .flatMap((n) => [n.label, ...(n.children?.map((c) => `  - ${c.label}`) ?? [])])
    .join("\n");

  const { text, usage } = await generateText({
    model: MODELS.outline,
    prompt: `你是知乎爆款内容写作专家。
选题：《${topic.title}》
创作立场：${stance || topic.angle}
${insightSummary ? `观点地图：\n${insightSummary}` : ""}

请返回一个 JSON 对象（只输出 JSON，不要有任何其他文字）：
{"hook":"开篇钩子句，制造张力让读者不得不继续读","corePoint":"核心观点一句话明确立场","arguments":["事实层：数据/案例/现象","逻辑层：因果/机制/原理","价值层：为什么对读者重要"],"interaction":"结尾互动引导，一个具体问题降低读者回复门槛"}

要求：
1. hook：前两句制造张力或提出反常识问题，吸引眼球
2. corePoint：一句话，鲜明立场，不说废话
3. arguments：3条，依次为事实层/逻辑层/价值层，每条30字内
4. interaction：结尾问题，让读者有话说
5. 字符串值中不要使用英文双引号，改用「」`,
  });

  const tokens = usage?.totalTokens ?? 0;
  const cost = calcCost("deepseek-chat", tokens);

  const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const repaired = jsonrepair(rawJson);
  const parsed = OutlineSchema.parse(JSON.parse(repaired));

  return { outline: parsed as Outline, tokens, cost };
}
