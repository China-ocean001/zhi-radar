// 全局类型定义

export type Domain = "AI产品" | "职场" | "情感" | "科技" | "故事";
export const DOMAINS: Domain[] = ["AI产品", "职场", "情感", "科技", "故事"];

// Stage 0-4 与原型一致
export type Stage = 0 | 1 | 2 | 3 | 4;

export interface TopicCard {
  id: string;
  title: string;
  source: string;
  fitScore: number;
  competition: "低" | "中" | "高";
  angle: string;
  domain: Domain;
  hotIndex?: number;
  demand?: string;
  gap?: string;
}

export interface ProtoTopicCard extends TopicCard {
  demand: string;
  gap: string;
}

export interface InsightNode {
  id: string;
  type: "core" | "pro" | "con" | "question" | "myth" | "case";
  label: string;
  children?: InsightNode[];
}

export interface Outline {
  hook: string;
  corePoint: string;
  arguments: string[];
  interaction: string;
}

export interface ScoreDimension {
  name: string;
  score: number;
  risk: "low" | "mid" | "high";
  reason: string;
}

export interface CriticResult {
  dimensions: ScoreDimension[];
  totalScore: number;
  pass: boolean;
  suggestions: string[];
  round: number;
}

export type DagStatus = "idle" | "running" | "done" | "error" | "retry";
export type DagNodeStatus = "waiting" | "running" | "done" | "rewrite";

export interface DagNode {
  id: string;
  label: string;
  model: string;
  status: DagNodeStatus;
  tokens?: number;
  cost?: number;
}

export interface CostStats {
  totalTokens: number;
  totalCost: number;
  ttft: number;
  cacheRate: number;
  agentBreakdown: Record<string, { tokens: number; cost: number }>;
}

export interface TraceEntry {
  key: string;
  name: string;
  model: string;
  status: "waiting" | "running" | "done" | "rewrite";
  ms?: string;
}

export interface AppState {
  // 领域
  domain: Domain | null;
  setDomain: (d: Domain) => void;

  // 选题
  topics: TopicCard[];
  setTopics: (t: TopicCard[]) => void;
  topicIndex: number;
  setTopicIndex: (i: number) => void;
  topicSelected: boolean;
  setTopicSelected: (v: boolean) => void;

  // 阶段（0-4，与原型 state.stage 一致）
  stage: Stage;
  setStage: (s: Stage) => void;

  // 立场
  selectedStance: boolean;
  setSelectedStance: (v: boolean) => void;

  // 草稿
  draft: string;
  setDraft: (d: string) => void;
  appendDraft: (chunk: string) => void;
  drafted: boolean;
  setDrafted: (v: boolean) => void;
  draftRewritten: boolean;
  setDraftRewritten: (v: boolean) => void;

  // Critic
  criticRound: number;
  setCriticRound: (r: number) => void;

  // 观点地图
  insightNodes: InsightNode[];
  setInsightNodes: (n: InsightNode[]) => void;

  // 大纲
  outline: Outline | null;
  setOutline: (o: Outline) => void;

  // DAG 节点
  dagNodes: DagNode[];
  setDagProgress: (doneKeys: string[], runningKey: string | null, rewrite?: boolean) => void;
  resetDag: () => void;

  // Trace
  traceEntries: TraceEntry[];
  setTraceEntries: (entries: TraceEntry[]) => void;

  // 成本
  costStats: CostStats;
  setCostStats: (s: Partial<CostStats>) => void;

  // DAG 状态文字
  dagStatusText: string;
  setDagStatusText: (s: string) => void;

  // OAuth
  oauthLoggedIn: boolean;
  setOauthLoggedIn: (v: boolean) => void;

  // 用户
  user: { name: string; avatar: string; token?: string } | null;
  setUser: (u: AppState["user"]) => void;

  // 全局重置
  resetAll: () => void;
}
