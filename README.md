# 知创雷达 Zhi-Radar
网址：https://zhi-radar-production.up.railway.app/

> 面向知乎创作者的 AI 选题 + 成稿工作台  
> 知乎黑客松参赛项目 · MVP 版本

## 核心能力

- **5 个 AI Agent 分工协作**：Trend → Insight → Outline → Draft → Critic
- **3小时创作流程压缩至30分钟**
- **流式草稿生成**：逐字弹出，丝滑体验
- **五维内容体检**：AI味 / 事实风险 / 营销风险 / 标题党 / 答非所问
- **Critic 自反馈循环**：不达标自动重写，最多 3 轮
- **知乎 OAuth 登录 + 一键发布想法**

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | Next.js 15 + React 19 + TypeScript |
| UI | shadcn/ui + Tailwind CSS + lucide-react |
| 流程可视化 | React Flow（DAG + 思维导图） |
| 状态管理 | Zustand |
| LLM 调用 | Vercel AI SDK（streamText / generateObject） |
| Agent 编排 | 自研 DAG 执行器（`src/lib/dag.ts`，~250行） |
| 缓存 | Upstash Redis（选题池 6h 缓存） |

## 5-Agent 模型分配

| Agent | 模型 | 职责 |
|-------|------|------|
| Trend Agent | DeepSeek V3 | 拉取热榜、聚类选题 |
| Insight Agent | Claude Sonnet 4.6 | 生成观点地图 |
| Outline Agent | Claude Sonnet 4.6 | 生成知乎专属大纲 |
| Draft Agent | Claude Sonnet 4.6 | 流式生成正文草稿 |
| Critic Agent | GPT-4o-mini | 五维评分 + 自反馈重写 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入各项 API Key

# 3. 启动开发服务器（无 API Key 时自动 mock 演示）
npm run dev

# 4. 运行 Eval Harness
npm run eval

# 5. 启动 MCP Server
npm run mcp
```

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `LLM_GATEWAY_URL` | 兼容 OpenAI 协议的 LLM 网关地址 |
| `LLM_GATEWAY_KEY` | 网关 API Key |
| `ZHIHU_APP_ID` | 知乎 Open Platform App ID |
| `ZHIHU_APP_KEY` | 知乎 Open Platform App Key |
| `NEXTAUTH_SECRET` | NextAuth 密钥 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis Token |
| `NEXT_PUBLIC_MOCK_MODE` | `true` = 纯 mock 演示，无需任何 API |

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── (dashboard)/page.tsx  # 三栏工作台主页
│   ├── actions.ts          # Server Actions（Agent 调用入口）
│   └── api/               # API 路由
│       ├── stream/draft/  # SSE 流式草稿
│       ├── auth/          # 知乎 OAuth
│       └── topics/        # 选题 API（MCP 用）
├── agents/                # 5 个 Agent
│   ├── trend.ts           # Trend Agent — DeepSeek V3
│   ├── insight.ts         # Insight Agent — Claude Sonnet
│   ├── outline.ts         # Outline Agent — Claude Sonnet
│   ├── draft.ts           # Draft Agent — Claude Sonnet（流式）
│   └── critic.ts          # Critic Agent — GPT-4o-mini
├── lib/
│   ├── llm.ts             # LLM 网关封装 + 模型路由
│   ├── dag.ts             # 自研 DAG 执行器（~250行）
│   ├── redis.ts           # Upstash Redis 缓存
│   ├── zhihu-api.ts       # 知乎 API 封装
│   ├── mock-data.ts       # 完整 mock 数据
│   └── utils.ts           # shadcn 工具函数
├── components/
│   ├── ui/                # shadcn 基础组件
│   ├── TopBar.tsx         # 顶栏（LOGO + 领域 + 成本面板 + 用户）
│   ├── CostPanel.tsx      # 实时成本面板
│   ├── left-bar/          # 选题池
│   ├── middle-bar/        # DAG + 思维导图 + 大纲 + 草稿
│   └── right-bar/         # 五维评分面板
├── store/
│   ├── index.ts           # Zustand Store
│   └── types.ts           # 全局类型定义
├── eval/harness.ts        # Eval Harness（10条用例 + HTML报告）
└── mcp/server.ts          # MCP Server（知乎热榜工具）
```

## 本地演示（无需任何 API Key）

设置 `NEXT_PUBLIC_MOCK_MODE=true`（`.env.local` 默认已设置），所有 Agent 调用将返回预设的 mock 数据，可完整体验三栏工作台。

## 部署到 Vercel

```bash
# 推送到 GitHub
git init && git add . && git commit -m "feat: 知创雷达 MVP"
git remote add origin <your-repo>
git push -u origin main

# 在 Vercel 控制台：
# 1. Import GitHub repo
# 2. 填写环境变量（见上表）
# 3. Deploy
```

## 知乎 OAuth 配置

1. 在[知乎开放平台](https://open.zhihu.com)创建应用
2. 回调地址设为：`https://zhi-radar.vercel.app/api/auth/callback/zhihu`
3. 申请权限：`public`、`read_user`、`write_note`
4. 将 App ID 和 App Key 填入环境变量

---

Made with ❤️ for 知乎黑客松
注明出处可以使用，商业用途请联系作者：18336816581或15225196086
