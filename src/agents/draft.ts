/**
 * Draft Agent — Claude Sonnet 4.6
 * 职责：基于大纲流式生成知乎正文草稿（800-1500字）
 * 返回 ReadableStream，前端逐字渲染
 */

"use server";

import { streamText } from "ai";
import { MODELS, calcCost } from "@/lib/llm";
import { DRAFT_ORIGINAL } from "@/lib/mock-data";
import type { Outline, TopicCard } from "@/store/types";

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

export interface DraftAgentInput {
  topic: TopicCard;
  outline: Outline;
  stance: string;
}

/**
 * 流式生成草稿
 * 返回 { stream: ReadableStream<string>, usage: Promise<{tokens, cost}> }
 */
export async function runDraftAgent(input: DraftAgentInput): Promise<{
  stream: ReadableStream<string>;
  getUsage: () => Promise<{ tokens: number; cost: number }>;
}> {
  const { topic, outline, stance } = input;

  // Mock 模式：把 mock 草稿模拟成流
  if (MOCK_MODE || !process.env.LLM_GATEWAY_URL) {
    const mockStream = mockTextStream(DRAFT_ORIGINAL.join("\n\n"));
    return {
      stream: mockStream,
      getUsage: async () => ({ tokens: 0, cost: 0 }),
    };
  }

  const prompt = `你是知乎高赞创作者，写作风格克制、真实、有密度，不废话。
选题：《${topic.title}》
创作立场：${stance || topic.angle}

大纲如下：
【钩子】${outline.hook}
【核心观点】${outline.corePoint}
【论证①】${outline.arguments[0]}
【论证②】${outline.arguments[1]}
【论证③】${outline.arguments[2]}
【结尾互动】${outline.interaction}

要求：
- 严格按大纲展开，800-1500字
- 开篇两句话必须使用钩子，不加「今天聊一聊」之类废话
- 每段之间用分隔线「---」隔开
- 加粗关键结论（使用 **内容** 语法）
- 用知乎 Markdown 格式（支持 **加粗** 和 --- 分隔线）
- 结尾必须保留互动引导句
- 禁止出现：「总结一下」「我认为」「希望对你有帮助」等套话`;

  const result = streamText({
    model: MODELS.draft,
    prompt,
    maxTokens: 2000,
    temperature: 0.8,
  });

  // 将 AI SDK TextStream 转为 ReadableStream<string>
  const stream = new ReadableStream<string>({
    async start(controller) {
      for await (const chunk of result.textStream) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const getUsage = async () => {
    const usage = await result.usage;
    const tokens = usage?.totalTokens ?? 0;
    return { tokens, cost: calcCost("claude-sonnet-4-6", tokens) };
  };

  return { stream, getUsage };
}

/** 模拟流式文本输出（每次吐出几个字符，间隔 20ms） */
function mockTextStream(text: string): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      const chars = text.split("");
      let i = 0;
      while (i < chars.length) {
        // 每次输出 1-4 个字符
        const chunk = chars.slice(i, i + Math.floor(Math.random() * 4) + 1).join("");
        controller.enqueue(chunk);
        i += chunk.length;
        await new Promise((r) => setTimeout(r, 20));
      }
      controller.close();
    },
  });
}
