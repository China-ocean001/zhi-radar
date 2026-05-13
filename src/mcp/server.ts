/**
 * 简易 MCP Server — 封装知乎热榜选题能力
 * 使用 HTTP SSE 协议暴露 tools
 * 启动：node src/mcp/server.mjs
 *
 * MCP tools 暴露：
 * - get_hot_topics: 获取知乎热榜聚类选题
 * - get_topics_by_domain: 按领域获取选题卡
 */

import http from "http";
import { URL } from "url";

const PORT = process.env.MCP_PORT || 3001;

// ─── Tool 定义 ────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_hot_topics",
    description: "获取知乎实时热榜并返回聚类后的选题卡列表",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["AI产品", "职场", "情感", "科技", "故事"],
          description: "内容领域",
        },
        limit: {
          type: "number",
          default: 5,
          description: "返回选题数量",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "get_insight_map",
    description: "基于选题标题生成观点地图（正反观点/读者疑问/误区）",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "选题标题",
        },
        angle: {
          type: "string",
          description: "切入角度",
        },
      },
      required: ["title"],
    },
  },
];

// ─── Mock 工具执行 ─────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>) {
  if (name === "get_hot_topics") {
    const domain = args.domain as string;
    // 直接调用 trend agent
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    try {
      const res = await fetch(`${baseUrl}/api/topics?domain=${encodeURIComponent(domain)}`);
      if (res.ok) return await res.json();
    } catch {}

    return { topics: [], message: "热榜 API 暂时不可用，请稍后重试" };
  }

  if (name === "get_insight_map") {
    const { MOCK_INSIGHT_NODES } = await import("../lib/mock-data.js");
    return { nodes: MOCK_INSIGHT_NODES };
  }

  return { error: `Unknown tool: ${name}` };
}

// ─── MCP HTTP SSE 服务器 ──────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 工具列表
  if (url.pathname === "/tools" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tools: TOOLS }));
    return;
  }

  // 工具调用
  if (url.pathname === "/call" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { name, arguments: args } = JSON.parse(body);
        const result = await executeTool(name, args || {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(result) }] }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // 健康检查
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", name: "zhi-radar-mcp", version: "0.1.0" }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`🔌 Zhi-Radar MCP Server 运行在 http://localhost:${PORT}`);
  console.log(`   工具列表: http://localhost:${PORT}/tools`);
  console.log(`   调用工具: POST http://localhost:${PORT}/call`);
});
