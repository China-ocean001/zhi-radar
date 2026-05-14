/**
 * GET /api/auth/callback/zhihu
 * 知乎 OAuth 回调 — 用 code 换取 access_token
 * 成功后重定向到主页并在 cookie 中存储 token（httpOnly）
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeToken } from "@/lib/zhihu-api";

function getBaseUrl(req: NextRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return `${proto}://${forwardedHost}`;
  const host = req.headers.get("host") || "localhost:3000";
  return host.includes("localhost") ? `http://${host}` : `https://${host}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const base = getBaseUrl(req);

  if (error || !code) {
    return NextResponse.redirect(`${base}/?auth_error=1`);
  }

  const redirectUri = `${base}/api/auth/callback/zhihu`;

  try {
    const { access_token, expires_in } = await exchangeToken(code, redirectUri);

    const response = NextResponse.redirect(`${base}/`);
    response.cookies.set("zh_token", access_token, {
      httpOnly: true,
      secure: !base.includes("localhost"),
      sameSite: "lax",
      maxAge: expires_in,
      path: "/",
    });
    return response;
  } catch (e) {
    console.error("OAuth exchange error:", e);
    return NextResponse.redirect(`${base}/?auth_error=exchange_failed`);
  }
}
