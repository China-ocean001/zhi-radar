/**
 * GET /api/auth/callback/zhihu
 * 知乎 OAuth 回调 — 用 code 换取 access_token
 * 成功后重定向到主页并在 cookie 中存储 token（httpOnly）
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeToken } from "@/lib/zhihu-api";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }

  const host = req.headers.get("host") || "zhi-radar.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/auth/callback/zhihu`;

  try {
    const { access_token, expires_in } = await exchangeToken(code, redirectUri);

    const response = NextResponse.redirect(new URL("/", req.url));
    response.cookies.set("zh_token", access_token, {
      httpOnly: true,
      secure: !host.includes("localhost"),
      sameSite: "lax",
      maxAge: expires_in,
      path: "/",
    });
    return response;
  } catch (e) {
    console.error("OAuth exchange error:", e);
    return NextResponse.redirect(new URL("/?auth_error=exchange_failed", req.url));
  }
}
