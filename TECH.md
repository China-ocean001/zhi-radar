# 知创雷达 Zhi-Radar — 技术文档

> 知乎 AI 创作工作台：5-Agent 协作，把 3 小时创作流程压缩到 30 分钟。

---

## 一、系统架构

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端框架 | Next.js 15 App Router + Turbopack | SSR + Server Actions，零配置流式支持 |
| UI | React 18 + 纯 CSS（无 UI 框架） | 手写 CSS 设计令牌，保证原型还原度 |
| AI SDK | Vercel AI SDK (`ai`) | `generateText` / `streamText` 统一抽象 |
| 模型 | DeepSeek V3 via OpenAI 兼容接口 | `@ai-sdk/openai` + `compatibility: "compatible"` |
| 数据验证 | Zod + jsonrepair | AI 输出的双重安全保障 |
| 状态管理 | React `useState` / `useCallback` | 无 Redux，保持轻量 |
| 部署 | Vercel / Netlify（Next.js 零配置） | `vercel.json` + `netlify.toml` 均已配置 |

### 整体流程

```
用户选领域
    │
    ▼
[Trend Agent] ──→ 知乎热榜抓取 + AI 多领域分类 → 选题池
    │
用户选题 + 点击「运行 Agent」
    │
    ▼
[Insight Agent] ──→ AI 提炼正反观点/疑问/误区 → 观点地图（Mindmap）
    │
用户从观点地图选择立场
    │
    ▼
[Outline Agent] ──→ AI 生成知乎式大纲（钩子/核心观点/论证层/互动） → 可编辑大纲
    │
用户点击「流式生成」
    │
    ▼
[Draft Agent] ──→ 流式输出 800-1500 字草稿（SSE 流式） → 实时打字效果
    │
用户点击「运行体检」
    │
    ▼
[Critic Agent] ──→ 五维评分 + 改进建议 → 可循环重写直到通过
```

---

## 二、数据抓取：知乎热榜

### 抓取机制

```typescript
// src/lib/zhihu-api.ts
export async function fetchHotList(accessToken?: string): Promise<ZhihuHotItem[]> {
  // 多端点容错：依次尝试，第一个成功的为准
  const endpoints = [
    `${ZHIHU_BASE}/hot/list?limit=20`,
    `${ZHIHU_BASE}/topstory/hot-lists/total?limit=20&desktop=true`,
    `${ZHIHU_BASE}/v4/top-stories?limit=20`,
  ];

  for (const url of endpoints) {
    const res = await fetch(url, { headers, next: { revalidate: 300 } });
    if (res.ok) return parseItems(await res.json()); // 解析成功即返回
  }

  return MOCK_HOT_LIST; // 所有端点失败时降级到 Mock 数据
}
```

**设计要点：**
- **多端点 Fallback**：知乎 API 格式在不同版本间有差异，兼容 3 种响应结构
- **Next.js 缓存**：`next: { revalidate: 300 }` 热榜 5 分钟内不重复请求
- **热度解析**：统一处理 `"2232 万热度"` / `9800` / `"9.8k"` 等多种格式
- **Mock 降级**：无 Access Token 时返回预置数据，保证演示不崩溃

### 去重与分页

```typescript
// seenIds 机制：标题做 key（避免大整数 ID 精度问题）
const seenSet = new Set(seenIds);
const newItems = allItems.filter(h => !seenSet.has(h.title));
const batch = newItems.slice(0, batchSize);
```

用户每次点"显示更多热点"，前端传入已读标题集合，服务端过滤后返回新内容，实现无限加载。

---

## 三、5-Agent Pipeline 详解

### Agent 1：Trend（选题分类）

**职责**：拿到热榜原始条目，AI 将其分类为 5 个领域的选题卡。

**核心能力**：
- 一条热点可归入多个领域（AI 推理重分类）
- 输出结构化选题卡：标题、创作角度、知乎适配度评分（1-5）、竞争度、需求信号、内容缺口

**技术实现**：`generateText` + `jsonrepair` + Zod 验证

---

### Agent 2：Insight（观点地图）

**职责**：针对选定选题，提炼正方观点、反方观点、读者疑问、常见误区、案例素材。

**输出数据结构**：

```typescript
interface InsightNode {
  id: string;
  type: "core" | "pro" | "con" | "question" | "myth" | "case";
  label: string;
  children?: InsightNode[];
}
```

**Mindmap 渲染**：采用 CSS Grid 模板布局（非 ReactFlow），固定槽位 `[pro, pro, con, question, question, myth]`，AI 内容按类型填入对应槽位。

**用户交互**：观点地图下方展示正反立场卡片，用户点击选择立场后直接触发 Outline Agent。

---

### Agent 3：Outline（大纲生成）

**职责**：基于选题 + 用户选定立场 + 观点地图，生成知乎式回答结构。

**输出结构**：

```typescript
interface Outline {
  hook: string;        // 开篇钩子（制造张力）
  corePoint: string;   // 核心观点（一句话立场）
  arguments: string[]; // 三层论证（事实层/逻辑层/价值层）
  interaction: string; // 结尾互动引导
}
```

大纲生成后展示在可编辑区域，用户可直接修改每一条后再生成草稿。

---

### Agent 4：Draft（流式草稿）

**职责**：基于大纲流式生成 800-1500 字知乎风格文章。

**流式实现**（SSE）：

```typescript
// src/app/api/stream/draft/route.ts
export async function POST(req: Request) {
  const { result } = streamText({ model: MODELS.draft, prompt });

  return result.toDataStreamResponse(); // Vercel AI SDK 内置 SSE 响应
}

// 前端消费流
const reader = res.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  // 解析 SSE data 帧，实时更新 draftLines + typingLine
  const parts = accumulated.split(/\n\n+/);
  setDraftLines(parts.slice(0, -1));      // 已完成段落
  setTypingLine(parts[parts.length - 1]); // 正在打字的段落
}
```

**打字效果**：将流式内容按双换行分段，已完成段落入 `draftLines`，最新段落绑定 `typingLine` 并附带 CSS 光标动画。

---

### Agent 5：Critic（五维体检）

**职责**：对草稿进行五维度质量评分，给出具体改进建议。

**五个维度**：

| 维度 | 检测内容 | 合格线 |
|------|----------|--------|
| AI 味检测 | 机械连接词、排比模板、均匀段落 | ≥ 80 |
| 事实风险 | 无来源数据、绝对化结论、术语错误 | ≥ 80 |
| 营销风险 | 产品推荐、引流语、二维码 | ≥ 85 |
| 标题党风险 | 夸张词、标题与内容不符、制造焦虑 | ≥ 80 |
| 答非所问 | 偏题、无关铺垫、核心观点模糊 | ≥ 80 |

**通过条件**：`totalScore ≥ 80` 且**无 high 风险维度**。

**关键设计——Chain-of-Thought 强制差异化评分**：

早期版本 AI 倾向于把 5 个维度打在同一区间（如全部 80-90），原因是模型先预设"这篇文章还不错"再填分数。

解决方案：**先找问题，再推导分数**。

```
# Prompt 设计
第一步：在 <analysis> 标签内，逐维度列出正文中找到的具体问题（引用原句），无问题写"无"。
第二步：根据找到的问题数量按扣分点区间算出各维度得分。
第三步：在 </analysis> 之后，只输出 JSON。
```

这迫使模型先做逐句检查，再从100分起扣，自然产生差异化分数（如 55/88/96/73/62）。

**JSON 提取安全处理**：

```typescript
// 分析文字在 <analysis> 标签内，JSON 在标签外，避免分析里的 { 干扰提取
const afterAnalysis = text.includes("</analysis>")
  ? text.slice(text.indexOf("</analysis>") + "</analysis>".length)
  : text;
const rawJson = afterAnalysis.slice(afterAnalysis.indexOf("{"), afterAnalysis.lastIndexOf("}") + 1);
const repaired = jsonrepair(rawJson); // 修复 AI 输出的 JSON 语法问题
const raw = CriticSchema.parse(JSON.parse(repaired)); // Zod 强类型验证
```

**服务端重新计算（不信任模型数值）**：

```typescript
// 不使用模型输出的 totalScore 和 pass，服务端独立计算
const totalScore = Math.round(
  raw.dimensions.reduce((sum, d) => sum + d.score, 0) / raw.dimensions.length
);
const hasHigh = raw.dimensions.some(d => d.risk === "high");
const pass = totalScore >= PASS_THRESHOLD && !hasHigh;
```

---

## 四、核心技术难点与解决方案

### 难点 1：DeepSeek `generateObject` 频繁失败

**问题**：DeepSeek V3 在工具调用（tool-calling）模式下，生成的 JSON 中标题字段含未转义引号（如 `"AI时代，为何"无所不知"？"`），导致 `AI_NoObjectGeneratedError`。

**解决**：全面切换至 `generateText` + `jsonrepair` + Zod 验证的三层管道。

```typescript
const { text } = await generateText({ model, prompt: "...返回 JSON..." });
const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
const repaired = jsonrepair(rawJson); // 自动修复引号、缺失括号等问题
const result = Schema.parse(JSON.parse(repaired));
```

### 难点 2：页面无限加载（中国网络环境）

**问题**：`globals.css` 中 `@import url('https://fonts.googleapis.com/...')` 是渲染阻塞资源，在中国无法访问，导致页面永久白屏。

**解决**：删除所有 Google Fonts 引用，改用本地字体栈：

```css
font-family: Inter, "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
```

### 难点 3：Turbopack 与 Webpack 缓存冲突

**问题**：多个旧 Node 进程（不带 `--turbopack`）向 `.next` 目录写入 webpack 产物，Turbopack 启动时读取到错误缓存，报 `Cannot find module './vendor-chunks/next.js'`。

**解决**：每次遇到此错误执行 `rm -rf .next` 清空缓存，再重启。

### 难点 4：Server Actions 不能导出非 async 对象

**问题**：`"use server"` 文件中尝试 `export const THRESHOLDS = {...}` 报错，因为 Server Actions 文件只能导出 async 函数。

**解决**：将常量内联到使用处，不从 `"use server"` 文件导出。

---

## 五、系统能力总结

### 核心能力

| 能力 | 说明 |
|------|------|
| 实时热榜抓取 | 调用知乎 OpenAPI，多端点容错，5 分钟缓存 |
| AI 多领域分类 | 一条热点智能拆解为多个创作角度 |
| 观点地图生成 | 自动提炼正反观点、读者疑问、常见误区 |
| 立场选择 | 基于观点地图卡片，用户一键选定创作立场 |
| 知乎式大纲 | 钩子→核心观点→三层论证→互动引导，可手动编辑 |
| 流式草稿生成 | SSE 实时输出，段落级打字效果 |
| 人工修改草稿 | 生成后可切换编辑模式直接修改文本 |
| 五维体检 | AI 逐句检查，差异化评分，引用原文定位问题 |
| Critic 重写循环 | 体检未通过时 Draft Agent 按建议重写，最多 3 轮 |
| 成本追踪 | 实时显示累计 Tokens、API 成本、TTFT |
| 知乎 OAuth 发布 | 对接知乎 OpenAPI，授权后一键发布想法 |

### 技术亮点

1. **零 UI 框架**：全部界面用 CSS 变量 + Grid 手写，保证设计稿还原度，无 Tailwind 组件库依赖
2. **AI 输出健壮性**：`generateText + jsonrepair + Zod` 三层保障，AI 输出再乱也能解析
3. **Chain-of-Thought 评分**：Critic Agent 通过结构化 Prompt 强制 AI 先找问题再打分，避免均值收敛
4. **服务端数据校验**：评分结果服务端独立重算，不信任模型输出的 totalScore/pass
5. **多端点容错**：知乎 API 兼容 3 种接口格式，任一失败自动切换

---

## 六、项目结构

```
src/
├── agents/           # 5 个 AI Agent（"use server" Server Actions）
│   ├── trend.ts      # 热榜抓取 + 分类
│   ├── insight.ts    # 观点地图生成
│   ├── outline.ts    # 大纲生成
│   ├── draft.ts      # 草稿（流式，via API Route）
│   └── critic.ts     # 五维体检
├── app/
│   ├── (dashboard)/  # 主工作台页面
│   ├── api/
│   │   └── stream/draft/  # SSE 流式 API Route
│   └── globals.css   # 全局 CSS 设计令牌
├── components/
│   └── Dashboard.tsx # 主 UI 组件（~1500 行，三栏布局）
├── lib/
│   ├── llm.ts        # 模型配置 + 成本计算
│   └── zhihu-api.ts  # 知乎 OpenAPI 封装
└── store/
    └── types.ts      # 全局类型定义
```

---

## 七、本地开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 填写 LLM_GATEWAY_URL、LLM_GATEWAY_KEY、ZHIHU_APP_ID、ZHIHU_APP_KEY

# 启动开发服务器（Turbopack）
npm run dev

# 快速演示（无需 API Key）
NEXT_PUBLIC_MOCK_MODE=true npm run dev
```
