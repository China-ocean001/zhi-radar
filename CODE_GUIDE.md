# 知创雷达 代码讲解手册

> 写给第一次看这份代码的你。不需要提前懂 AI，边读边理解即可。

---

## 先理解这个项目在干什么

想象你是一个知乎创作者，想写一篇爆款文章。你需要：

1. **找热点**：刷知乎热榜，挑一个有话说的话题
2. **分析角度**：想清楚别人都是怎么看这个话题的，自己站哪边
3. **列大纲**：想好文章结构，开头怎么吸引人，中间怎么论证，结尾怎么互动
4. **写草稿**：按大纲把文章写出来
5. **质量把关**：检查文章有没有 AI 腔、有没有夸大、有没有跑题

这 5 件事，项目里有 5 个 AI"员工"分别负责，叫做 **5-Agent Pipeline**。

```
Trend Agent → Insight Agent → Outline Agent → Draft Agent → Critic Agent
（找热点）    （分析观点）     （写大纲）       （写草稿）     （质量体检）
```

---

## 项目文件夹结构

```
D:/zhihu/
├── src/
│   ├── agents/          ← 5个 AI 员工的代码
│   │   ├── trend.ts     ← 负责抓热榜、分类选题
│   │   ├── insight.ts   ← 负责分析观点、生成观点地图
│   │   ├── outline.ts   ← 负责生成文章大纲
│   │   ├── draft.ts     ← 负责流式生成草稿
│   │   └── critic.ts    ← 负责五维质量体检
│   │
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   └── page.tsx  ← 网站首页（把 Dashboard 组件放上去）
│   │   ├── api/
│   │   │   └── stream/draft/route.ts  ← 草稿流式接口（边生成边传给浏览器）
│   │   ├── globals.css   ← 全站样式（颜色、按钮、布局都在这里）
│   │   └── layout.tsx    ← 网页的 HTML 外壳（head 标签等）
│   │
│   ├── components/
│   │   └── Dashboard.tsx ← 整个页面的 UI 代码（三栏布局、所有按钮逻辑）
│   │
│   └── lib/
│       ├── llm.ts        ← AI 接口配置（连接 DeepSeek，计算花了多少钱）
│       ├── zhihu-api.ts  ← 知乎 API 封装（怎么抓热榜、怎么发布文章）
│       └── types.ts      ← 数据结构定义（各种数据长什么样）
```

---

## 第一层：数据结构（types.ts）

在看具体代码之前，先看看数据长什么样。这就像看一份表格的表头。

```typescript
// 一张"选题卡"的数据结构
interface TopicCard {
  id: string;           // 唯一编号，比如 "hot-001"
  title: string;        // 标题，比如 "DeepSeek 出新模型，普通人还该学 AI 吗？"
  source: string;       // 来源，比如 "知乎热榜"
  fitScore: number;     // 知乎适配度 1-5 分
  competition: "低" | "中" | "高";  // 竞争激烈程度
  angle: string;        // AI 建议的创作角度
  domain: Domain;       // 所属领域（AI产品/职场/情感/科技/故事）
  demand?: string;      // 需求信号，比如 "高"
  gap?: string;         // 内容缺口，比如 "缺少实操案例"
}
```

```typescript
// 观点地图里一个节点的数据结构
interface InsightNode {
  id: string;    // 节点编号
  type: "core" | "pro" | "con" | "question" | "myth" | "case";
  //     核心议题   支持观点   反对观点   读者疑问   常见误区   案例素材
  label: string; // 节点文字内容
  children?: InsightNode[]; // 子节点（核心节点的孩子就是所有其他节点）
}
```

```typescript
// 文章大纲的数据结构
interface Outline {
  hook: string;        // 开篇钩子（让读者想继续读的第一句话）
  corePoint: string;   // 核心观点（一句话说清楚你的立场）
  arguments: string[]; // 三层论证（事实层、逻辑层、价值层）
  interaction: string; // 结尾互动（引导读者评论的问题）
}
```

```typescript
// 体检结果的数据结构
interface ScoreDimension {
  name: string;                    // 维度名，比如 "AI味检测"
  score: number;                   // 0-100 分
  risk: "low" | "mid" | "high";    // 风险等级
  reason: string;                  // 具体原因（引用原文哪里有问题）
}
```

---

## 第二层：AI 接口配置（llm.ts）

这个文件只做一件事：**告诉代码去哪里找 AI、用哪个模型、怎么算钱**。

```typescript
// 用 OpenAI 格式的 SDK 连接 DeepSeek
// 因为 DeepSeek 提供了"和 OpenAI 一样格式"的接口，所以可以直接复用
const gateway = createOpenAI({
  baseURL: "https://api.deepseek.com/v1",  // DeepSeek 的服务器地址
  apiKey: "sk-...",                         // API 密钥（从环境变量读取）
  compatibility: "compatible",              // 告诉 SDK：用兼容模式，不要用 OpenAI 独有的功能
});

// 5 个 Agent 都用同一个模型：deepseek-chat（就是 DeepSeek V3）
export const MODELS = {
  trend:   gateway("deepseek-chat"),
  insight: gateway("deepseek-chat"),
  outline: gateway("deepseek-chat"),
  draft:   gateway("deepseek-chat"),
  critic:  gateway("deepseek-chat"),
};

// 计算花了多少钱（deepseek-chat 每 1000 个 token 约 0.00055 美元）
export function calcCost(model: string, tokens: number): number {
  return (tokens / 1000) * 0.00055;
}
```

**什么是 token？** 可以理解为"字符数"。AI 处理文字的计费单位，大约每 1.5 个汉字 = 1 个 token。

---

## 第三层：知乎 API 封装（zhihu-api.ts）

这个文件负责**和知乎服务器通信**，主要做三件事：

### 1. 抓取热榜

```typescript
export async function fetchHotList(): Promise<ZhihuHotItem[]> {
  // 问题：知乎 API 的格式不固定，新旧版本长得不一样
  // 解决：同时准备 3 个地址，挨个试，哪个成功用哪个
  const endpoints = [
    "https://api.zhihu.com/hot/list?limit=20",           // 格式A
    "https://api.zhihu.com/topstory/hot-lists/total...", // 格式B
    "https://api.zhihu.com/v4/top-stories?limit=20",     // 格式C
  ];

  for (const url of endpoints) {
    const res = await fetch(url, { next: { revalidate: 300 } });
    // revalidate: 300 = Next.js 会缓存这个结果 300 秒（5分钟）
    // 5分钟内重复请求直接用缓存，不重复打 API
    if (res.ok) {
      const items = parseItems(await res.json()); // 把数据标准化
      if (items.length > 0) return items;         // 成功就返回
    }
  }

  return MOCK_HOT_LIST; // 3 个都失败？返回假数据，保证程序不崩溃
}
```

### 2. 解析热度数字

知乎热榜的热度数值格式乱七八糟，这个函数统一处理：

```typescript
function parseHeat(raw: unknown): number {
  // "2232 万热度" → 22320000
  // "9.8k"        → 9800
  // 9800          → 9800（已经是数字，直接用）
  const s = String(raw);
  const match = s.match(/([\d.]+)\s*([万kK]?)/);
  if (unit === "万") return n * 10000;
  if (unit === "k") return n * 1000;
  return n; // 纯数字
}
```

### 3. 发布文章

```typescript
export async function publishIdea(params) {
  // 调用知乎 OpenAPI 发布"想法"（短内容）
  const res = await fetch("https://api.zhihu.com/pins", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
    body: JSON.stringify({
      content: [{ type: "text", content: params.content }]
    }),
  });
  return { url: `https://www.zhihu.com/pin/${data.id}` };
}
```

---

## 第四层：5 个 AI Agent

### Agent 1 — Trend（找热点、分类）

**文件**：`src/agents/trend.ts`

**它做什么**：拿到热榜 20 条，让 AI 把每条变成一张"选题卡"，归类到 5 个领域。

**去重机制**：每次只处理没见过的热榜条目

```typescript
// seenIds = 已经处理过的标题列表（存在前端）
// 这样用户点"显示更多"时，不会重复出现同样的选题
const newItems = allItems.filter(h => !seenSet.has(h.title));
const batch = newItems.slice(0, 10); // 每次最多处理 10 条
```

**AI 的 Prompt 核心逻辑**：
```
给你 10 条知乎热榜，帮我把每条变成一张选题卡：
- 判断它属于哪个领域（可以多个）
- 给出一个独特的创作角度（不要人云亦云）
- 评估知乎适配度（1-5分）
- 评估竞争度（低/中/高）
- 找出需求信号和内容缺口
```

---

### Agent 2 — Insight（生成观点地图）

**文件**：`src/agents/insight.ts`

**它做什么**：针对一个选题，让 AI 生成 6 个不同视角的观点卡片。

**输出固定结构**：2个支持 + 1个反对 + 2个读者疑问 + 1个常见误区

```typescript
// Prompt 明确要求输出这个结构
{"core":"核心议题","nodes":[
  {"id":"p1","type":"pro",      "label":"支持观点1"},
  {"id":"p2","type":"pro",      "label":"支持观点2"},
  {"id":"c1","type":"con",      "label":"反对观点1"},
  {"id":"q1","type":"question", "label":"读者疑问1"},
  {"id":"q2","type":"question", "label":"读者疑问2"},
  {"id":"m1","type":"myth",     "label":"常见误区1"}
]}
```

**数据组装**：把 AI 返回的扁平节点，组装成树形结构（核心节点 → 子节点）：

```typescript
// AI 返回的是扁平数组：[p1, p2, c1, q1, q2, m1]
// 我们把它组装成树：core → children: [p1, p2, c1, q1, q2, m1]
const coreNode: InsightNode = {
  id: "core",
  type: "core",
  label: parsed.core,           // 核心议题文字
  children: parsed.nodes,       // 6个观点作为子节点
};
return { nodes: [coreNode] };   // 返回以核心节点为根的树
```

---

### Agent 3 — Outline（生成大纲）

**文件**：`src/agents/outline.ts`

**它做什么**：把"选题 + 用户选的立场 + 观点地图"输入给 AI，生成知乎式文章大纲。

```typescript
// 把观点地图转成文字传给 AI
const insightSummary = insightNodes
  .flatMap((n) => [n.label, ...(n.children?.map(c => `  - ${c.label}`) ?? [])])
  .join("\n");
// 效果：
// 核心议题：AI时代普通人如何自处
//   - 支持：AI是工具，学会用即可
//   - 反对：AI会取代很多人的工作
//   - 疑问：普通人从哪里开始学？
//   ...
```

**Prompt 要求 AI 返回**：
- `hook`：开篇两句话，要有张力或反常识
- `corePoint`：一句话明确立场
- `arguments`：3条（事实层/逻辑层/价值层）
- `interaction`：结尾问题，让读者有话说

---

### Agent 4 — Draft（流式生成草稿）

**文件**：`src/agents/draft.ts` + `src/app/api/stream/draft/route.ts`

这是最复杂的一个 Agent，因为用了**流式输出**——就像 ChatGPT 那样，字一个一个出现，而不是等全部生成完再显示。

**为什么要流式？**
- 草稿有 800-1500 字，如果等全部生成完再显示，用户要盯着空白页等 10-15 秒
- 流式输出让用户看到进度，体验好很多

**流式的原理（SSE）**：

```
浏览器                              服务器
  │                                   │
  │── POST /api/stream/draft ────────>│ 开始生成
  │                                   │
  │<── data: {"text":"在"}  ──────────│ 字1
  │<── data: {"text":"这个"}──────────│ 字2~3
  │<── data: {"text":"时代"}──────────│ 字4~5
  │<── data: [DONE]   ────────────────│ 生成结束
```

这种技术叫 **SSE（Server-Sent Events，服务器推送事件）**，服务器可以主动往浏览器推数据。

**服务端代码**（`route.ts`）：

```typescript
export async function POST(req: Request) {
  const { topic, outline, stance } = await req.json();

  // 调用 Draft Agent，拿到一个"流"
  const { stream } = await runDraftAgent({ topic, outline, stance });

  // 把流包装成 SSE 格式传给浏览器
  const sseStream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await stream.read();
        if (done) break;

        // 每次读到新文字，就打包成 SSE 格式发出去
        const data = `data: ${JSON.stringify({ text: value })}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n")); // 结束信号
      controller.close();
    },
  });

  return new Response(sseStream, {
    headers: { "Content-Type": "text/event-stream" } // 告诉浏览器这是流
  });
}
```

**前端接收代码**（`Dashboard.tsx`）：

```typescript
const reader = res.body.getReader(); // 打开流读取器
let accumulated = ""; // 累积已收到的文字

while (true) {
  const { done, value } = await reader.read(); // 读一块数据
  if (done) break;

  // 解码：浏览器收到的是二进制，先转成文字
  const text = decoder.decode(value);

  // 解析 SSE 格式，提取 data: 后面的内容
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = JSON.parse(line.slice(6));
    accumulated += payload.text; // 拼接所有文字

    // 按两个换行分段（一段 = 一个自然段）
    const parts = accumulated.split(/\n\n+/);
    setDraftLines(parts.slice(0, -1));      // 已完成的段落
    setTypingLine(parts[parts.length - 1]); // 正在输入的段落（带光标动画）
  }
}
```

---

### Agent 5 — Critic（五维体检）

**文件**：`src/agents/critic.ts`

这是设计最精妙的 Agent，重点解释两个核心问题。

**问题 1：为什么之前 AI 总打出相近的分数？**

假设草稿写得还不错，AI 会先在脑子里判断"这篇文章总体 80 分"，然后把 5 个维度都打在 78-82 之间。这样的评分毫无参考价值。

**解决方案：让 AI 先找问题，再推导分数**

```
传统方式（AI的内心）：
  "这篇文章不错，给个 82 分吧" → 5个维度都 80 左右 ❌

新方式（强制 Chain-of-Thought）：
  "先逐句找问题：
    AI味检测：找到「首先/其次/最后」连用 → 扣 15 分 → 85分
    事实风险：没发现问题 → 满分 → 97分
    营销风险：没发现问题 → 满分 → 96分
    标题党风险：轻微焦虑句 → 扣 10 分 → 90分
    答非所问：前两段铺垫过多 → 扣 20 分 → 80分"
  → 自然产生差异化分数 ✅
```

**代码实现**：

```typescript
// Prompt 分三步走
`第一步：在 <analysis> 标签内，逐维度列出正文中找到的问题（引用原句）。
 第二步：根据问题数量，从100分逐条扣分，算出各维度得分。
 第三步：</analysis> 之后只输出 JSON。`
```

**问题 2：AI 输出里有文字和 JSON 混在一起，怎么只提取 JSON？**

```typescript
// AI 的实际输出长这样：
// <analysis>
// AI味检测：找到「首先/其次/最后」...（一大段分析文字）
// </analysis>
// {"dimensions":[...]}

// 如果直接找第一个 { 会截到分析文字里的 {
// 解决：先跳过 </analysis> 之前的所有内容，再找 {
const afterAnalysis = text.includes("</analysis>")
  ? text.slice(text.indexOf("</analysis>") + "</analysis>".length)
  : text;

// 现在 afterAnalysis 只有 JSON 部分了
const rawJson = afterAnalysis.slice(afterAnalysis.indexOf("{"), afterAnalysis.lastIndexOf("}") + 1);
```

**为什么不信任 AI 返回的 totalScore 和 pass？**

```typescript
// AI 可能算错，也可能偷懒直接编一个
// 服务端自己重新算，100% 准确
const totalScore = Math.round(
  raw.dimensions.reduce((sum, d) => sum + d.score, 0) / raw.dimensions.length
);
// 只要有一个维度是 high 风险，就算不通过
const hasHigh = raw.dimensions.some(d => d.risk === "high");
const pass = totalScore >= 80 && !hasHigh; // 服务端自己判断，不信 AI 的
```

---

## 第五层：最关键的通用模式

整个项目里，所有 Agent 调用 AI 的代码都长这样：

```typescript
// 第1步：让 AI 生成文字（不用 generateObject，因为 DeepSeek 会损坏 JSON）
const { text, usage } = await generateText({
  model: MODELS.trend,  // 用哪个模型
  prompt: `...提示词...返回JSON格式...`,
});

// 第2步：从文字里找到 JSON 部分
const rawJson = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

// 第3步：用 jsonrepair 修复可能的语法问题（比如少了引号、多了逗号）
const repaired = jsonrepair(rawJson);

// 第4步：用 Zod 验证数据结构是否符合预期
const result = SomeSchema.parse(JSON.parse(repaired));
```

**为什么要这么麻烦，不直接用 `generateObject`？**

`generateObject` 是 AI SDK 提供的直接生成结构化 JSON 的方法。但 DeepSeek V3 在这个模式下有一个 bug：

```
// 当 AI 生成这种内容时：
{ "title": "AI时代，为何"无所不知"？" }
//                      ↑↑↑ 这里的引号没有被转义

// 导致 JSON 解析出错：
SyntaxError: Unexpected token u in JSON at position 15
```

`jsonrepair` 这个库专门修复这类 AI 生成的"不太标准的 JSON"。

---

## 第六层：页面 UI（Dashboard.tsx）

整个页面是**三栏布局**：

```
┌──────────────┬─────────────────────────┬──────────────┐
│              │                         │              │
│   左栏       │        中栏             │   右栏       │
│   选题池     │   主工作台              │   Critic体检 │
│   ~340px     │   （弹性宽度）          │   ~360px     │
│              │                         │              │
└──────────────┴─────────────────────────┴──────────────┘
```

**状态管理**：整个页面用 React 的 `useState` 管理所有状态，大约 20 多个状态变量：

```typescript
const [stage, setStage] = useState(0);         // 当前到第几步（0-4）
const [insightNodes, setInsightNodes] = useState([]); // 观点地图数据
const [draftLines, setDraftLines] = useState([]); // 草稿内容（每段一行）
const [criticScores, setCriticScores] = useState(null); // 体检评分
// ... 等等
```

**五个阶段的页面切换**：

```typescript
// stage = 0：选领域
// stage = 1：选题池
// stage = 2：观点地图（等 Insight Agent 跑完）
// stage = 3：大纲+草稿（选完立场后）
// stage = 4：Critic体检（草稿生成后）

// StagePanel 根据 stage 决定显示什么
function StagePanel({ stage, ... }) {
  if (stage === 0) return <领域选择界面 />;
  if (stage === 1) return <选题池界面 />;
  if (stage === 2) return <观点地图 + 立场选择 />;
  if (stage === 3) return <大纲编辑 + 草稿区域 />;
  return <体检结果 + 草稿区域 />; // stage === 4
}
```

---

## 常见问题

**Q：`"use server"` 是什么意思？**

A：这是 Next.js 的指令。加了这行，这个文件里的函数就会在**服务器上运行**，而不是在用户的浏览器里运行。好处是：API 密钥不会暴露给用户；坏处是：不能用浏览器专属 API（比如 `window`）。

**Q：为什么有的函数是 `async`，有的不是？**

A：`async` 表示这个函数会做一些"需要等待"的事情，比如请求 API、读取数据库。有 `await` 的地方就是"等一下，数据还没回来"。

**Q：Zod 是干什么的？**

A：Zod 是一个"数据验证"库。就像海关检查护照一样：AI 返回的数据必须符合我们预定义的格式，不符合就报错。这防止了 AI 乱返回东西导致程序崩溃。

```typescript
const CardSchema = z.object({
  title: z.string(),              // title 必须是字符串
  fitScore: z.number().min(1).max(5), // fitScore 必须是 1-5 的数字
  competition: z.enum(["低","中","高"]), // competition 只能是这三个值之一
});

CardSchema.parse(aiOutput); // 如果 aiOutput 不符合上面的结构，直接报错
```

**Q：`useCallback` 是什么？**

A：React 的性能优化工具。被它包裹的函数，只在依赖项变化时才重新创建，避免不必要的重新渲染。可以暂时忽略它，把里面的函数当普通函数看就行。
