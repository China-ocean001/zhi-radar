/**
 * Server Actions — 统一入口
 * 所有 Agent 调用通过此文件，禁止客户端直连模型
 */

"use server";

import { fetchAndClassifyHot, type ClassifyOutput } from "@/agents/trend";
import { runInsightAgent, type InsightAgentInput, type InsightAgentOutput } from "@/agents/insight";
import { runOutlineAgent, type OutlineAgentInput, type OutlineAgentOutput } from "@/agents/outline";
import { runCriticAgent, type CriticAgentInput, type CriticAgentOutput } from "@/agents/critic";
import { publishIdea } from "@/lib/zhihu-api";

// ─── 加载选题池 ───────────────────────────────────────────

export async function loadTopics(opts?: { seenIds?: string[]; batchSize?: number }): Promise<ClassifyOutput> {
  return fetchAndClassifyHot(opts);
}

// ─── 生成观点地图 ──────────────────────────────────────────

export async function generateInsight(
  input: InsightAgentInput
): Promise<InsightAgentOutput> {
  return runInsightAgent(input);
}

// ─── 生成大纲 ─────────────────────────────────────────────

export async function generateOutline(
  input: OutlineAgentInput
): Promise<OutlineAgentOutput> {
  return runOutlineAgent(input);
}

// ─── 运行 Critic 评分 ─────────────────────────────────────

export async function runCritic(
  input: CriticAgentInput
): Promise<CriticAgentOutput> {
  return runCriticAgent(input);
}

// ─── 一键发布到知乎 ───────────────────────────────────────

export async function publishToZhihu(params: {
  content: string;
  accessToken: string;
}): Promise<{ id: string; url: string }> {
  return publishIdea(params);
}
