/**
 * GET /api/auth/login/zhihu
 * 发起知乎 OAuth 授权
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOAuthUrl } from "@/lib/zhihu-api";

function getBaseUrl(req: NextRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  const host = req.headers.get("host") || "localhost:3000";
  return host.includes("localhost") ? `http://${host}` : `https://${host}`;
}

export function GET(req: NextRequest) {
  if (!process.env.ZHIHU_APP_ID) {
    return NextResponse.json({ error: "ZHIHU_APP_ID 未配置" }, { status: 501 });
  }

  const redirectUri = `${getBaseUrl(req)}/api/auth/callback/zhihu`;
  const state = crypto.randomUUID();
  const authUrl = buildOAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
