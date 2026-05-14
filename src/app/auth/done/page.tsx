"use client";

import { useEffect, useState } from "react";

export default function AuthDone() {
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    // 通知父窗口（不论 opener 是否跨域，用 * 确保送达）
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "zhihu-auth-done" }, "*");
      }
    } catch {}

    // 尝试关闭弹窗
    window.close();

    // 如果 300ms 后还没关闭，显示手动关闭按钮
    const t = setTimeout(() => setCanClose(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#374151", background: "#f8fafc" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>知乎授权成功！</p>
        <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>正在关闭窗口，请稍候…</p>
        {canClose && (
          <button
            onClick={() => window.close()}
            style={{ padding: "10px 24px", background: "#0084ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            关闭此窗口
          </button>
        )}
      </div>
    </div>
  );
}
