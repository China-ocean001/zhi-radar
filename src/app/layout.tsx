import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知创雷达 Zhi-Radar | 知乎AI创作工作台",
  description: "面向知乎创作者的 AI 选题 + 成稿工作台，5个AI Agent分工协作，3小时创作流程压缩至30分钟",
  keywords: ["知乎", "AI创作", "内容创作", "选题", "AI写作"],
  openGraph: {
    title: "知创雷达 Zhi-Radar",
    description: "AI 驱动的知乎创作工作台",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background">
        {children}
      </body>
    </html>
  );
}
