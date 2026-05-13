/**
 * Trend Agent — 抓取知乎热榜 + AI 多领域分类
 * 每条热点可归入多个领域；保证每个领域至少 1 张选题卡
 */

"use server";

import { generateText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { MODELS } from "@/lib/llm";
import { fetchHotList } from "@/lib/zhihu-api";
import type { Domain, ProtoTopicCard } from "@/store/types";

const ALL_DOMAINS = ["AI产品", "职场", "情感", "科技", "故事"] as const;

const CardSchema = z.object({
  domain: z.enum(ALL_DOMAINS),
  title: z.string(),
  angle: z.string(),
  fitScore: z.number().min(1).max(5),
  competition: z.enum(["低", "中", "高"]),
  demand: z.string(),
  gap: z.string(),
  sourceIndex: z.number().int().min(0),
});

const OutputSchema = z.object({ cards: z.array(CardSchema) });

export interface ClassifyOutput {
  cardsByDomain: Record<Domain, ProtoTopicCard[]>;
  processedIds: string[];
  hasMore: boolean;
  error?: string;
}

function emptyOutput(hasMore = false, error?: string): ClassifyOutput {
  return {
    cardsByDomain: Object.fromEntries(ALL_DOMAINS.map(d => [d, []])) as unknown as Record<Domain, ProtoTopicCard[]>,
    processedIds: [],
    hasMore,
    error,
  };
}

export async function fetchAndClassifyHot(input: {
  seenIds?: string[];
  batchSize?: number;
} = {}): Promise<ClassifyOutput> {
  const { seenIds = [], batchSize = 10 } = input;

  // 1. 拉取热榜
  let allItems;
  try {
    allItems = await fetchHotList();
  } catch (e) {
    console.error("[Trend] fetchHotList failed:", e);
    return emptyOutput(false, "热榜接口请求失败");
  }

  if (!allItems.length) return emptyOutput(false, "热榜返回空数据");

  // 2. 过滤已处理条目（用标题做 key，避免大整数 ID 精度问题）
  const seenSet = new Set(seenIds);
  const newItems = allItems.filter(h => !seenSet.has(h.title));
  const batch = newItems.slice(0, batchSize);

  if (batch.length === 0) return emptyOutput(false);

  // 3. AI 分类 — 用 generateText + jsonrepair 避免 AI 内容含双引号破坏 JSON
  const hotSummary = batch
    .map((h, i) => `[${i}] ${h.title}（${h.heat}）`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: MODELS.trend,
      prompt: `你是知乎内容专家，领域：AI产品/职场/情感/科技/故事。

热榜${batch.length}条：
${hotSummary}

请返回一个 JSON 对象，格式如下（只输出 JSON，不要有任何其他文字）：
{"cards":[{"domain":"领域","title":"知乎风格标题","angle":"独特切入角度","fitScore":4,"competition":"中","demand":"需求信号","gap":"内容缺口","sourceIndex":0},...]}

规则：
1. 每条热榜选1-2个最匹配的领域生成选题卡
2. 五个领域（AI产品/职场/情感/科技/故事）各至少1张
3. sourceIndex为热榜序号(0-based，最大${batch.length - 1})
4. 字符串值中不要使用英文双引号，改用「」`,
    });

    // 修复 AI 返回的不合法 JSON（如标题中含引号等）
    const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const repaired = jsonrepair(rawJson);
    const parsed = OutputSchema.parse(JSON.parse(repaired));

    const cardsByDomain = Object.fromEntries(
      ALL_DOMAINS.map(d => [d, [] as ProtoTopicCard[]])
    ) as unknown as Record<Domain, ProtoTopicCard[]>;

    parsed.cards.forEach((c, i) => {
      const hot = batch[Math.min(c.sourceIndex, batch.length - 1)];
      cardsByDomain[c.domain as Domain].push({
        id: `${c.domain}-${hot.title.slice(0, 8)}-${i}`,
        domain: c.domain as Domain,
        title: c.title,
        source: hot.title,
        angle: c.angle,
        fitScore: c.fitScore,
        competition: c.competition,
        hotIndex: hot.heat,
        demand: c.demand,
        gap: c.gap,
      });
    });

    return {
      cardsByDomain,
      processedIds: batch.map(h => h.title),
      hasMore: newItems.length > batchSize,
    };
  } catch (e) {
    console.error("[Trend] classify failed:", e);
    return emptyOutput(false, "AI 分类失败，请点击重试");
  }
}

// 向后兼容
export async function runTrendAgent(input: { domain: Domain }) {
  const result = await fetchAndClassifyHot({ batchSize: 10 });
  return { topics: result.cardsByDomain[input.domain] ?? [], tokens: 0, cost: 0, fromCache: false };
}
