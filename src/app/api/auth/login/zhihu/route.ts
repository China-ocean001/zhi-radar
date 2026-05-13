/**
 * GET /api/auth/login/zhihu
 * 发起知乎 OAuth 授权
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOAuthUrl } from "@/lib/zhihu-api";

export function GET(req: NextRequest) {
  const host = req.headers.get("host") || "zhi-radar.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/auth/callback/zhihu`;

  const state = crypto.randomUUID();
  const authUrl = buildOAuthUrl(redirectUri, state);

  // 如果没有配置 AppID，返回提示
  if (!process.env.ZHIHU_APP_ID) {
    return NextResponse.json(
      { error: "ZHIHU_APP_ID 未配置，请在 .env.local 中填写" },
      { status: 501 }
    );
  }

  return NextResponse.redirect(authUrl);
}
