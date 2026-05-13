/**
 * GET /api/topics?domain=AI产品
 * 用于 MCP Server 内部调用，返回缓存的选题卡
 */

import { NextRequest, NextResponse } from "next/server";
import { runTrendAgent } from "@/agents/trend";
import type { Domain } from "@/store/types";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain") as Domain;

  if (!domain) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }

  try {
    const result = await runTrendAgent({ domain });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
