/**
 * LLM 网关封装 — DeepSeek API
 * 所有 Agent 统一走 deepseek-chat（DeepSeek V3）
 */

import { createOpenAI } from "@ai-sdk/openai";

const GATEWAY_URL = process.env.LLM_GATEWAY_URL || "https://api.deepseek.com/v1";
const GATEWAY_KEY = process.env.LLM_GATEWAY_KEY || "";

export const gateway = createOpenAI({
  baseURL: GATEWAY_URL,
  apiKey: GATEWAY_KEY,
  compatibility: "compatible",
});

// 所有 Agent 均使用 deepseek-chat（DeepSeek V3）
export const MODELS = {
  trend:   gateway("deepseek-chat"),
  insight: gateway("deepseek-chat"),
  outline: gateway("deepseek-chat"),
  draft:   gateway("deepseek-chat"),
  critic:  gateway("deepseek-chat"),
} as const;

// deepseek-chat 定价：输入 $0.27/M tokens，输出 $1.10/M tokens，折中估算
export const COST_PER_1K: Record<string, number> = {
  "deepseek-chat": 0.00055,
};

export function calcCost(model: string, tokens: number): number {
  const rate = COST_PER_1K[model] ?? COST_PER_1K["deepseek-chat"];
  return (tokens / 1000) * rate;
}
