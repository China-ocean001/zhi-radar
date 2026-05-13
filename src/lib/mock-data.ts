import type { InsightNode, Outline, CriticResult } from "@/store/types";

// ─── 观点地图 Mock ────────────────────────────────────────

export const MOCK_INSIGHT_NODES: InsightNode[] = [
  {
    id: "core", type: "core",
    label: "AI 正在重塑知识工作者的价值",
    children: [
      { id: "pro-1", type: "pro", label: "✅ 效率大幅提升，释放创造力", children: [
        { id: "pro-1-1", type: "case", label: "案例：编程提速 40%" },
        { id: "pro-1-2", type: "case", label: "案例：报告撰写缩短至 1 小时" },
      ]},
      { id: "pro-2", type: "pro", label: "✅ 降低领域知识门槛", children: [] },
      { id: "con-1", type: "con", label: "❌ 同质化内容泛滥，差异化更难", children: [
        { id: "con-1-1", type: "myth", label: "误区：AI 内容质量低" },
      ]},
      { id: "con-2", type: "con", label: "❌ 依赖风险：工具变化快", children: [] },
      { id: "q-1", type: "question", label: "🤔 读者疑问：哪些工作真的会消失？", children: [] },
      { id: "q-2", type: "question", label: "🤔 读者疑问：如何保持竞争力？", children: [] },
    ],
  },
];

// ─── 大纲 Mock ────────────────────────────────────────────

export const MOCK_OUTLINE: Outline = {
  hook: "如果有一天你的 AI 同事比你更懂你的客户，你会怎么想？",
  corePoint: "AI 工具不是职业威胁，而是筛选「真正有判断力的人」的新标准",
  arguments: [
    "【事实层】数据与案例：哪些岗位已受影响，哪些逆势增长",
    "【逻辑层】AI 放大的是人的判断力，而非技能本身，没有判断力的人无论用不用 AI 都会被淘汰",
    "【价值层】真正的竞争力来自「问出好问题」的能力，这是 AI 无法直接提供的",
  ],
  interaction: "你现在用 AI 最大的卡点是什么？欢迎评论区分享，我来帮你拆解。",
};

// ─── 草稿 Mock（原版 + 重写版） ──────────────────────────

export const DRAFT_ORIGINAL = [
  `最近很多人都在问"DeepSeek 出新模型，普通人现在还该学 AI 吗"。我的判断是，普通人当然要学 AI，而且越快越好，因为不学就会被淘汰。`,
  "但是这句话说得太满了。真正的问题不是学不学，而是学什么。很多人每天看模型发布会、收藏提示词合集、研究各种榜单，最后自己的工作流没有任何变化。你会发现，焦虑被喂饱了，产出却没有变多。",
  "对知乎创作者来说，一个更实用的答案是：先学会用 AI 做判断辅助。比如选题时，不要只看热榜名次，还要看已有回答是否拥挤、读者评论里还有哪些没被回答的问题、自己有没有独特经验可以补充。",
  "如果没有这些判断，AI 生成得越快，低质内容就越多。工具不会自动带来观点，模型也不会替你承担事实责任。真正稳定的创作流程，应该是 AI 给你信息密度，人来决定立场、边界和表达。",
  "所以，与其问普通人该不该学 AI，不如问：我能不能把 AI 放进一个真实任务里，并且每次都能更快、更稳地完成它？",
];

export const DRAFT_REWRITTEN = [
  `我不太建议普通创作者把"追上最新模型"当成学习 AI 的目标。以"DeepSeek 出新模型，普通人现在还该学 AI 吗"这个问题为例，真正值得讨论的不是参数更大、榜单更高，而是普通人能不能把 AI 放进一个稳定产出的工作流里。`,
  "知乎创作最难的地方，往往不是写出第一段，而是判断这个题值不值得写。热榜代表讨论密度，搜索结果代表已有供给，评论区代表读者真正没有被回答的问题。把这三件事拆开看，选题就不再只是凭感觉押注。",
  "如果我是产品经理视角，我会把 AI 学习分成三层：第一层是会提问，第二层是会验证，第三层是会把结果接回自己的业务或创作流程。大多数人停在第一层，所以用起来像玩具；真正产生复利的是第二层和第三层。",
  "这也是知创雷达想解决的问题：Trend Agent 帮你找到有讨论价值的题，Insight Agent 帮你看到正反观点，Outline 和 Draft 负责把结构铺开，Critic 最后检查 AI 味、事实风险和标题党。AI 负责把信息处理变快，人负责判断边界和立场。",
  "所以，普通人当然该学 AI，但不是把每个新模型都追一遍。更现实的学习方式是：从一个高频任务开始，把它拆成输入、判断、输出、复核四步，再让 AI 进入其中一两步。这样学到的不是热闹，而是能持续迁移的能力。你现在最想交给 AI 的创作环节是哪一步？",
];

// ─── Critic 评分 Mock ────────────────────────────────────

export const CRITIC_SCORES_ROUND1 = [
  { name: "AI 味",   value: 72, tone: "warn" },
  { name: "事实风险", value: 64, tone: "warn" },
  { name: "营销风险", value: 22, tone: "good" },
  { name: "标题党",   value: 57, tone: "warn" },
  { name: "答非所问", value: 18, tone: "good" },
];

export const CRITIC_SCORES_ROUND2 = [
  { name: "AI 味",   value: 41, tone: "good" },
  { name: "事实风险", value: 28, tone: "good" },
  { name: "营销风险", value: 18, tone: "good" },
  { name: "标题党",   value: 26, tone: "good" },
  { name: "答非所问", value: 12, tone: "good" },
];

export const MOCK_CRITIC_RESULT: CriticResult = {
  totalScore: 82, pass: true, round: 1,
  suggestions: [
    "可增加 1-2 个具体数据佐证「效率是三倍」的说法",
    "结尾互动问题可以更具体，降低读者回复门槛",
  ],
  dimensions: [
    { name: "AI味检测", score: 88, risk: "low", reason: "语言自然，口语化程度高，无明显模板痕迹" },
    { name: "事实风险", score: 75, risk: "mid", reason: "「效率三倍」缺乏数据来源，建议注明" },
    { name: "营销风险", score: 92, risk: "low", reason: "无明显推销语气，观点中立客观" },
    { name: "标题党风险", score: 85, risk: "low", reason: "标题与内容匹配度高" },
    { name: "答非所问", score: 90, risk: "low", reason: "内容紧扣主题，逻辑链条完整" },
  ],
};
