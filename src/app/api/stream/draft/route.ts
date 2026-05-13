/**
 * POST /api/stream/draft
 * 流式生成草稿，返回 SSE 格式
 * 前端通过 fetch + ReadableStream 接收
 */

import { NextRequest } from "next/server";
import { runDraftAgent } from "@/agents/draft";
import type { TopicCard, Outline } from "@/store/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    topic: TopicCard;
    outline: Outline;
    stance?: string;
  };

  const { topic, outline, stance = "" } = body;

  if (!topic || !outline) {
    return new Response("Missing topic or outline", { status: 400 });
  }

  const { stream, getUsage } = await runDraftAgent({ topic, outline, stance });

  // 将文本流转为 SSE 格式
  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // SSE 数据帧
          const data = `data: ${JSON.stringify({ text: value })}\n\n`;
          controller.enqueue(encoder.encode(data));
        }

        // 发送 usage 信息
        const usage = await getUsage();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ usage })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
