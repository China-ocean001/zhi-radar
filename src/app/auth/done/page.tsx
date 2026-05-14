"use client";

import { useEffect } from "react";

export default function AuthDone() {
  useEffect(() => {
    // 通知父窗口授权完成，然后关闭弹窗
    if (window.opener) {
      window.opener.postMessage({ type: "zhihu-auth-done" }, window.location.origin);
      window.close();
    } else {
      // 非弹窗模式（整页跳转），直接回首页
      window.location.href = "/";
    }
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#374151" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <p style={{ fontSize: 16 }}>知乎授权成功，正在关闭窗口…</p>
      </div>
    </div>
  );
}
