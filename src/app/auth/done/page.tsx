"use client";

import { useEffect, useState } from "react";

export default function AuthDone() {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // 主要通信方式：写 localStorage，主窗口监听 storage 事件
    localStorage.setItem("zhihu-auth-ts", String(Date.now()));

    // 备用：postMessage
    try {
      if (window.opener) window.opener.postMessage({ type: "zhihu-auth-done" }, "*");
    } catch {}

    // 尝试关闭弹窗
    window.close();

    // 300ms 后如果还在，显示关闭按钮并跳回主页
    const t = setTimeout(() => {
      setClosed(true);
      // 如果不是弹窗（在新标签页打开的），直接跳回主页
      if (!window.opener) window.location.href = "/";
    }, 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"sans-serif", background:"#f8fafc" }}>
      <div style={{ textAlign:"center", padding:40 }}>
        <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
        <p style={{ fontSize:18, fontWeight:600, color:"#111", marginBottom:8 }}>知乎授权成功！</p>
        <p style={{ fontSize:14, color:"#6b7280", marginBottom:24 }}>正在返回…</p>
        {closed && (
          <button onClick={() => window.opener ? window.close() : (window.location.href = "/")}
            style={{ padding:"10px 24px", background:"#0084ff", color:"#fff", border:"none", borderRadius:8, fontSize:14, fontWeight:600, cursor:"pointer" }}>
            返回主页
          </button>
        )}
      </div>
    </div>
  );
}
