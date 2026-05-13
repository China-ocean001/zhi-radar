/**
 * Insight Agent — DeepSeek V3
 * 生成多维观点地图（正反观点/读者疑问/误区/案例）
 * 使用 generateText + jsonrepair，避免 DeepSeek 工具调用模式下 JSON 损坏
 */

"use server";

import { generateText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { MODELS, calcCost } from "@/lib/llm";
import { MOCK_INSIGHT_NODES } from "@/lib/mock-data";
import type { InsightNode, TopicCard } from "@/store/types";

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

const NodeSchema = z.object({
  id: z.string(),
  type: z.enum(["pro", "con", "question", "myth", "case"]),
  label: z.string(),
});

const InsightMapSchema = z.object({
  core: z.string(),
  nodes: z.array(NodeSchema),
});

export interface InsightAgentInput {
  topic: TopicCard;
}

export interface InsightAgentOutput {
  nodes: InsightNode[];
  tokens: number;
  cost: number;
}

export async function runInsightAgent(
  input: InsightAgentInput
): Promise<InsightAgentOutput> {
  const { topic } = input;

  if (MOCK_MODE || !process.env.LLM_GATEWAY_URL) {
    return { nodes: MOCK_INSIGHT_NODES, tokens: 0, cost: 0 };
  }

  const { text, usage } = await generateText({
    model: MODELS.insight,
    prompt: `你是知乎内容策略专家。
选题：《${topic.title}》
切入角度：${topic.angle}

请返回一个 JSON 对象（只输出 JSON，不要有任何其他文字）：
{"core":"核心议题一句话","nodes":[{"id":"p1","type":"pro","label":"支持观点1"},{"id":"p2","type":"pro","label":"支持观点2"},{"id":"c1","type":"con","label":"反对观点1"},{"id":"q1","type":"question","label":"读者疑问1"},{"id":"q2","type":"question","label":"读者疑问2"},{"id":"m1","type":"myth","label":"常见误区1"}]}

要求：
1. core：核心议题一句话，20字内
2. nodes 必须包含：2个 pro（支持观点）、1个 con（反对观点）、2个 question（读者疑问）、1个 myth（常见误区）
3. label 用中文，25字内，简洁有力
4. 字符串值中不要使用英文双引号，改用「」`,
  });

  const tokens = usage?.totalTokens ?? 0;
  const cost = calcCost("deepseek-chat", tokens);

  const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const repaired = jsonrepair(rawJson);
  const parsed = InsightMapSchema.parse(JSON.parse(repaired));

  const coreNode: InsightNode = {
    id: "core",
    type: "core",
    label: parsed.core,
    children: parsed.nodes.map((n) => ({ ...n, children: [] })) as InsightNode[],
  };

  return { nodes: [coreNode], tokens, cost };
}
