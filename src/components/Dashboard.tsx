"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Radar, Layers3, GitBranch, TrendingUp, ScanSearch, ListChecks,
  FileText, ShieldCheck, RotateCcw, Play, WandSparkles, Send,
  Activity, Gauge, ListTree, PlugZap, KeyRound, Check, Search,
  Network, FilePenLine, MousePointerClick, ListFilter, RefreshCw,
} from "lucide-react";
import {
  DRAFT_ORIGINAL, DRAFT_REWRITTEN,
} from "@/lib/mock-data";
import type { Domain, Stage, DagNodeStatus, TraceEntry, Outline, InsightNode, ProtoTopicCard } from "@/store/types";
import { runOutlineAgent } from "@/agents/outline";
import { runCriticAgent } from "@/agents/critic";
import { fetchAndClassifyHot } from "@/agents/trend";
import { runInsightAgent } from "@/agents/insight";
import { checkAuth, logout } from "@/app/actions";
import type { ZhihuUser } from "@/lib/zhihu-api";

// ── 常量 ─────────────────────────────────────────────────
const DOMAINS: Domain[] = ["AI产品", "职场", "情感", "科技", "故事"];

const AGENT_DEFS = [
  { key: "trend",   name: "Trend",   icon: TrendingUp,  desc: "热榜、搜索、全网讨论聚类",      model: "DeepSeek V3" },
  { key: "insight", name: "Insight", icon: ScanSearch,  desc: "提炼正反观点与读者疑问",         model: "DeepSeek V3" },
  { key: "outline", name: "Outline", icon: ListChecks,  desc: "生成知乎式回答结构",             model: "DeepSeek V3" },
  { key: "draft",   name: "Draft",   icon: FileText,    desc: "流式生成 800-1500 字草稿",       model: "DeepSeek V3" },
  { key: "critic",  name: "Critic",  icon: ShieldCheck, desc: "5 维度体检与自反馈",             model: "DeepSeek V3" },
];

const STEPS = [
  { title: "1 选领域", desc: "选择创作方向" },
  { title: "2 选题池", desc: "领域确认后生成" },
  { title: "3 观点地图", desc: "Agent 执行后展示" },
  { title: "4 大纲草稿", desc: "选立场后生成" },
  { title: "5 Critic", desc: "手动多次体检" },
];

const COST_TABLE: Record<string, [number, string, string, string]> = {
  idle:    [0,     "$0.000", "0ms",   "0%"],
  trend:   [1850,  "$0.002", "340ms", "76%"],
  insight: [6420,  "$0.014", "620ms", "78%"],
  outline: [8940,  "$0.022", "710ms", "80%"],
  draft:   [14880, "$0.045", "790ms", "82%"],
  critic:  [16540, "$0.048", "810ms", "82%"],
  rewrite: [21490, "$0.061", "770ms", "86%"],
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const LOCKED_OUTLINE = [
  "等待选择主立场后生成结构。",
  "当前观点地图已经列出正反观点、疑问、误区和案例。",
];

// ── 主组件 ───────────────────────────────────────────────
export default function Dashboard() {
  // ── State ───────────────────────────────────────────────
  const [domain, setDomainState] = useState<Domain | null>(null);
  const [topicIndex, setTopicIndex] = useState(0);
  const [stage, setStage] = useState<Stage>(0);
  const [topicSelected, setTopicSelected] = useState(false);
  const [selectedStance, setSelectedStance] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [draftRewritten, setDraftRewritten] = useState(false);
  const [criticRound, setCriticRound] = useState(0);
  const [oauthLoggedIn, setOauthLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState<ZhihuUser | null>(null);
  const [dagStatusText, setDagStatusText] = useState("等待用户运行");
  const [cacheState, setCacheState] = useState("等待选择领域");
  const [showToast, setShowToast] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [dagNodeStatus, setDagNodeStatus] = useState<Record<string, DagNodeStatus>>({
    trend: "waiting", insight: "waiting", outline: "waiting", draft: "waiting", critic: "waiting",
  });
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>(
    AGENT_DEFS.map((a) => ({ key: a.key, name: a.name, model: a.model, status: "waiting" }))
  );
  const [costStage, setCostStage] = useState("idle");
  const [draftLines, setDraftLines] = useState<string[]>([]);
  const [typingLine, setTypingLine] = useState<string | null>(null);

  // 5维评分
  const [scoreRound, setScoreRound] = useState(0);

  // 可编辑大纲
  const [outlineItems, setOutlineItems] = useState<string[]>(LOCKED_OUTLINE);
  // 结构化大纲（供 Draft Agent 使用）
  const [outlineData, setOutlineData] = useState<Outline | null>(null);
  // 重写前的原始草稿
  const [originalDraftLines, setOriginalDraftLines] = useState<string[]>([]);
  // Critic 真实评分（null 时未运行）
  const [criticScores, setCriticScores] = useState<{ name: string; value: number; tone: string; reason: string }[] | null>(null);
  const [criticSuggestions, setCriticSuggestions] = useState<string[]>([]);
  const [criticPass, setCriticPass] = useState<boolean | null>(null);
  // 热榜分类选题（按领域缓存，切换领域不重新抓取）
  const [classifiedTopics, setClassifiedTopics] = useState<Record<Domain, ProtoTopicCard[]>>({
    "AI产品": [], "职场": [], "情感": [], "科技": [], "故事": [],
  });
  const [seenHotIds, setSeenHotIds] = useState<string[]>([]);
  const [isFetchingTopics, setIsFetchingTopics] = useState(false);
  const [hasMoreHot, setHasMoreHot] = useState(true);
  const [topicFetchError, setTopicFetchError] = useState<string | null>(null);
  // Insight Agent 返回的真实观点节点
  const [insightNodes, setInsightNodes] = useState<InsightNode[]>([]);

  const draftRef = useRef<HTMLDivElement>(null);
  const typingIdRef = useRef(0);

  // 当前领域的选题列表（所有领域共享一次抓取结果）
  const currentTopics: ProtoTopicCard[] = domain ? (classifiedTopics[domain] ?? []) : [];
  const activeTopic: ProtoTopicCard | null = domain ? currentTopics[topicIndex] ?? null : null;

  // ── DAG 进度更新 ─────────────────────────────────────────
  const updateDag = useCallback(
    (doneKeys: string[], runningKey: string | null, rewrite = false) => {
      setDagNodeStatus(() => {
        const next: Record<string, DagNodeStatus> = {};
        for (const a of AGENT_DEFS) {
          if (doneKeys.includes(a.key)) next[a.key] = "done";
          else if (a.key === runningKey) next[a.key] = rewrite ? "rewrite" : "running";
          else next[a.key] = "waiting";
        }
        return next;
      });
    },
    []
  );

  const updateTrace = useCallback((stage: string) => {
    const statusMap: Record<string, string[]> = {
      idle: [], trend: ["trend"], insight: ["trend", "insight"],
      outline: ["trend", "insight", "outline"],
      draft: ["trend", "insight", "outline", "draft"],
      critic: ["trend", "insight", "outline", "draft", "critic"],
    };
    const done = statusMap[stage] ?? [];
    setTraceEntries(
      AGENT_DEFS.map((a) => ({
        key: a.key, name: a.name, model: a.model,
        status: done.includes(a.key) ? "done" : "waiting",
        ms: done.includes(a.key) ? `${Math.floor(420 + Math.random() * 1200)}ms` : undefined,
      }))
    );
  }, []);

  // ── 选领域 ───────────────────────────────────────────────
  const selectDomain = useCallback((d: Domain) => {
    setDomainState(d);
    setTopicIndex(0);
    setStage(1);
    setTopicSelected(false);
    setSelectedStance(false);
    setDrafted(false);
    setDraftRewritten(false);
    setCriticRound(0);
    setScoreRound(0);
    setDraftLines([]);
    setTypingLine(null);
    setCacheState(`${d} · 选题池已生成`);
    updateDag(d ? ["trend"] : [], null);
    updateTrace("trend");
    setCostStage("trend");
    setOutlineItems(LOCKED_OUTLINE);
    setOutlineData(null);
    setOriginalDraftLines([]);
    setCriticScores(null);
    setCriticSuggestions([]);
    setCriticPass(null);
    // classifiedTopics 不清除 — 切换领域直接复用已分类数据
    setInsightNodes([]);
  }, [updateDag, updateTrace]);

  // 首次加载：检查知乎登录态并处理 OAuth 回调结果
  useEffect(() => {
    checkAuth().then(({ loggedIn, user }) => {
      setOauthLoggedIn(loggedIn);
      setAuthUser(user);
    }).catch(() => {});
    // 处理 OAuth 回调错误
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      setDagStatusText("知乎授权失败，请重试");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // 监听弹窗授权完成消息（postMessage 备用）
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "zhihu-auth-done") refreshAuth();
    };
    // 主要通信：localStorage storage 事件（跨域 OAuth 后最可靠）
    const onStorage = (e: StorageEvent) => {
      if (e.key === "zhihu-auth-ts") refreshAuth();
    };
    const refreshAuth = () => {
      checkAuth().then(({ loggedIn, user }) => {
        setOauthLoggedIn(loggedIn);
        setAuthUser(user);
        if (loggedIn) setDagStatusText("知乎账号已连接 ✓");
      }).catch(() => {});
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开知乎 OAuth 弹窗，轮询弹窗关闭后刷新登录态
  const openLoginPopup = useCallback(() => {
    const w = 520, h = 680;
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(
      "/api/auth/login/zhihu", "zhihu-oauth",
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,resizable=yes`
    );
    if (!popup) return;
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        checkAuth().then(({ loggedIn, user }) => {
          setOauthLoggedIn(loggedIn);
          setAuthUser(user);
          if (loggedIn) setDagStatusText("知乎账号已连接 ✓");
        }).catch(() => {});
      }
    }, 600);
  }, []);

  // 首次加载：抓取 25 条热榜并分类到所有领域
  useEffect(() => {
    setIsFetchingTopics(true);
    setTopicFetchError(null);
    fetchAndClassifyHot({ batchSize: 10 })
      .then(({ cardsByDomain, processedIds, hasMore, error }) => {
        if (error) {
          setTopicFetchError(error);
          setHasMoreHot(false);
        } else {
          setClassifiedTopics(cardsByDomain as Record<Domain, ProtoTopicCard[]>);
          setSeenHotIds(processedIds);
          setHasMoreHot(hasMore);
        }
      })
      .catch((e) => {
        console.error("[Topics] initial fetch failed:", e);
        setTopicFetchError("热榜抓取失败，请刷新重试");
        setHasMoreHot(false);
      })
      .finally(() => setIsFetchingTopics(false));
  }, []);

  // 手动加载更多热点（reset=true 时清空已读列表，从头抓取）
  const loadMoreTopics = useCallback((reset = false) => {
    if (isFetchingTopics) return;
    const idsToUse = reset ? [] : seenHotIds;
    setIsFetchingTopics(true);
    setTopicFetchError(null);
    if (reset) setSeenHotIds([]);
    fetchAndClassifyHot({ seenIds: idsToUse, batchSize: 10 })
      .then(({ cardsByDomain, processedIds, hasMore, error }) => {
        if (error) {
          setTopicFetchError(error);
          return;
        }
        if (reset) {
          setClassifiedTopics(cardsByDomain as Record<Domain, ProtoTopicCard[]>);
        } else {
          setClassifiedTopics(prev => {
            const next = { ...prev } as Record<Domain, ProtoTopicCard[]>;
            (Object.keys(cardsByDomain) as Domain[]).forEach(d => {
              next[d] = [...(prev[d] ?? []), ...(cardsByDomain[d] as ProtoTopicCard[])];
            });
            return next;
          });
        }
        setSeenHotIds(prev => [...(reset ? [] : prev), ...processedIds]);
        setHasMoreHot(hasMore);
      })
      .catch((e) => {
        console.error("[Topics] load more failed:", e);
        setTopicFetchError("加载失败，请重试");
      })
      .finally(() => setIsFetchingTopics(false));
  }, [isFetchingTopics, seenHotIds]);

  // ── 选题 ─────────────────────────────────────────────────
  const selectTopic = useCallback((index: number) => {
    setTopicIndex(index);
    setTopicSelected(true);
    setSelectedStance(false);
    setDrafted(false);
    setDraftRewritten(false);
    setCriticRound(0);
    setScoreRound(0);
    setDraftLines([]);
    setTypingLine(null);
    setStage(1);
    setOutlineItems(LOCKED_OUTLINE);
    setOutlineData(null);
    setOriginalDraftLines([]);
    setCriticScores(null);
    setCriticSuggestions([]);
    setCriticPass(null);
    setInsightNodes([]);
  }, []);

  // ── 运行 Agent Pipeline（Insight） ───────────────────────
  const runPipeline = useCallback(async () => {
    if (!topicSelected || !domain) {
      setDagStatusText(domain ? "请先从左侧选题池选择一个题目" : "请先选择领域生成选题池");
      return;
    }
    setIsRunning(true);

    // Trend 已在首次加载时完成，直接标记完成，进入 Insight
    updateDag(["trend"], "insight");
    updateTrace("insight");
    setCostStage("insight");

    // ── Insight Agent ─────────────────────────────────────
    setDagStatusText("Insight Agent 正在绘制观点地图…");
    if (activeTopic) {
      try {
        const insightResult = await runInsightAgent({ topic: activeTopic });
        setInsightNodes(insightResult.nodes);
      } catch {
        // 降级：保留空节点（Mindmap 显示占位状态）
      }
    }

    updateDag(["trend", "insight"], null);
    setDagStatusText("观点地图已就绪，请选择主立场");
    updateTrace("insight");
    setCostStage("insight");
    setStage(2);
    setIsRunning(false);
  }, [topicSelected, domain, activeTopic, updateDag, updateTrace]);

  // ── 选立场 ───────────────────────────────────────────────
  const chooseStance = useCallback(async (stance: string) => {
    setSelectedStance(true);
    setStage(3);
    setDagStatusText("Outline Agent 正在生成大纲…");
    updateDag(["trend", "insight"], "outline");
    updateTrace("outline");
    setCostStage("outline");
    setOutlineItems(["大纲生成中，请稍候…"]);

    if (activeTopic) {
      try {
        const result = await runOutlineAgent({
          topic: activeTopic,
          stance: stance || activeTopic.angle,
          insightNodes,
        });
        setOutlineData(result.outline);
        setOutlineItems([
          `钩子：${result.outline.hook}`,
          `核心观点：${result.outline.corePoint}`,
          ...result.outline.arguments,
          `互动：${result.outline.interaction}`,
        ]);
      } catch (e) {
        console.error("[Outline] failed:", e);
        setOutlineItems(["大纲生成失败，请重新点击立场重试。"]);
      }
    }

    updateDag(["trend", "insight", "outline"], null);
    setDagStatusText("大纲已生成，可编辑后生成草稿");
  }, [activeTopic, insightNodes, updateDag, updateTrace]);

  // ── 打字动画 ─────────────────────────────────────────────
  const typeDraft = useCallback(async (paragraphs: string[]) => {
    const id = ++typingIdRef.current;
    setDraftLines([]);
    setTypingLine("");

    for (const para of paragraphs) {
      if (typingIdRef.current !== id) break;
      setTypingLine("");
      for (let i = 0; i <= para.length; i += 2) {
        if (typingIdRef.current !== id) break;
        setTypingLine(para.slice(0, i));
        await sleep(8);
      }
      if (typingIdRef.current !== id) break;
      setTypingLine(null);
      setDraftLines((prev) => [...prev, para]);
    }
    setTypingLine(null);
  }, []);

  // ── 生成草稿 ─────────────────────────────────────────────
  const generateDraft = useCallback(async () => {
    if (!selectedStance || !activeTopic) return;
    setIsRunning(true);
    setDagStatusText("Draft Agent 流式生成中");
    updateDag(["trend", "insight", "outline"], "draft");
    updateTrace("draft");
    setCostStage("draft");
    setDraftLines([]);
    setTypingLine(null);
    setDraftRewritten(false);
    setCriticRound(0);
    setScoreRound(0);
    setOriginalDraftLines([]);
    setCriticScores(null);
    setCriticSuggestions([]);
    setCriticPass(null);

    // 构建结构化大纲（优先用 AI 生成的，否则从编辑项重建）
    const outline: Outline = outlineData ?? {
      hook:        outlineItems[0]?.replace(/^钩子[：:]/, "") ?? "",
      corePoint:   outlineItems[1]?.replace(/^核心观点[：:]/, "") ?? "",
      arguments:   outlineItems.slice(2, 5),
      interaction: outlineItems[5]?.replace(/^互动[：:]/, "") ?? "",
    };

    try {
      const res = await fetch("/api/stream/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: activeTopic, outline, stance: activeTopic.angle }),
      });

      if (!res.ok || !res.body) throw new Error("stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              accumulated += parsed.text;
              // 已完成的段落推入 draftLines，最新段落放 typingLine
              const parts = accumulated.split(/\n\n+/);
              setDraftLines(parts.slice(0, -1).filter(Boolean));
              setTypingLine(parts[parts.length - 1] ?? "");
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // 完成：所有段落转 draftLines
      const finalParts = accumulated.split(/\n\n+/).filter(Boolean);
      setDraftLines(finalParts);
      setTypingLine(null);
    } catch {
      // 降级：使用本地演示数据
      await typeDraft(DRAFT_ORIGINAL);
    }

    setDrafted(true);
    setStage(4);
    setDagStatusText("草稿已生成，请手动运行 Critic 体检");
    updateDag(["trend", "insight", "outline", "draft"], null);
    updateTrace("draft");
    setCostStage("draft");
    setIsRunning(false);
  }, [selectedStance, activeTopic, outlineData, outlineItems, updateDag, updateTrace, typeDraft]);

  // ── 运行 Critic ───────────────────────────────────────────
  const runCriticCheck = useCallback(async () => {
    if (!drafted || !activeTopic) {
      setDagStatusText("请先生成草稿再运行 Critic");
      return;
    }
    setIsRunning(true);
    const nextRound = criticRound + 1;
    setDagStatusText(`Critic Agent 第 ${nextRound} 次体检中`);
    updateDag(["trend", "insight", "outline", "draft"], "critic");
    updateTrace("critic");
    setCostStage("critic");

    try {
      const result = await runCriticAgent({
        topic: activeTopic,
        draft: draftLines.join("\n\n"),
        round: nextRound,
      });
      setCriticScores(result.dimensions.map((d) => ({
        name: d.name,
        value: d.score,
        tone: d.risk === "low" ? "good" : d.risk === "mid" ? "warn" : "bad",
        reason: d.reason,
      })));
      setCriticSuggestions(result.suggestions ?? []);
      setCriticPass(result.pass);
    } catch (e) {
      console.error("[Critic] failed:", e);
      setDagStatusText("体检失败，请重试");
    }

    setCriticRound(nextRound);
    setScoreRound(nextRound);
    updateDag(["trend", "insight", "outline", "draft", "critic"], null);
    setDagStatusText(nextRound === 1 ? "体检发现风险，可重写或再次体检" : `第 ${nextRound} 次体检完成`);
    setIsRunning(false);
  }, [drafted, activeTopic, criticRound, draftLines, updateDag, updateTrace]);

  // ── Critic 重写 ───────────────────────────────────────────
  const rewriteDraft = useCallback(async () => {
    if (!drafted || !activeTopic) return;
    setIsRunning(true);
    setDagStatusText("Critic 反馈 Draft Agent 重写");
    updateDag(["trend", "insight", "outline", "critic"], "draft", true);
    setCostStage("rewrite");
    setTraceEntries([
      { key: "critic", name: "Critic", model: "DeepSeek V3", status: "done",    ms: "512ms" },
      { key: "draft",  name: "Draft",  model: "DeepSeek V3", status: "rewrite", ms: "执行中" },
      { key: "critic2",name: "Critic", model: "DeepSeek V3", status: "waiting" },
    ]);
    setOriginalDraftLines(draftLines);
    setDraftLines([]);
    setTypingLine(null);

    // 构建大纲
    const outline: Outline = outlineData ?? {
      hook:        outlineItems[0]?.replace(/^钩子[：:]/, "") ?? "",
      corePoint:   outlineItems[1]?.replace(/^核心观点[：:]/, "") ?? "",
      arguments:   outlineItems.slice(2, 5),
      interaction: outlineItems[5]?.replace(/^互动[：:]/, "") ?? "",
    };

    try {
      const res = await fetch("/api/stream/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: activeTopic, outline, stance: "重写优化版，根据 Critic 反馈去除 AI 味，补充数据支撑，保持核心观点不变" }),
      });

      if (!res.ok || !res.body) throw new Error("stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              accumulated += parsed.text;
              const parts = accumulated.split(/\n\n+/);
              setDraftLines(parts.slice(0, -1).filter(Boolean));
              setTypingLine(parts[parts.length - 1] ?? "");
            }
          } catch { /* ignore */ }
        }
      }

      const finalParts = accumulated.split(/\n\n+/).filter(Boolean);
      setDraftLines(finalParts);
      setTypingLine(null);
    } catch {
      await typeDraft(DRAFT_REWRITTEN);
    }

    setDraftRewritten(true);
    setCriticRound((r) => Math.max(r, 1));
    setScoreRound(2);
    setCriticScores(null);
    setCriticSuggestions([]);
    setCriticPass(null);
    updateDag(["trend", "insight", "outline", "draft", "critic"], null);
    setDagStatusText("已根据 Critic 建议重写，可再次运行体检");
    setIsRunning(false);
  }, [drafted, activeTopic, draftLines, outlineData, outlineItems, updateDag, typeDraft]);

  // ── 发布 ──────────────────────────────────────────────────
  const publish = useCallback(() => {
    if (!oauthLoggedIn) {
      openLoginPopup();
      return;
    }
    if (!drafted || criticRound < 1) {
      setDagStatusText("请先生成草稿并运行至少一次 Critic 体检");
      return;
    }
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3600);
  }, [oauthLoggedIn, drafted, criticRound]);

  // ── 重置演示 ───────────────────────────────────────────────
  const resetDemo = useCallback(() => {
    typingIdRef.current++;
    setDomainState(null);
    setTopicIndex(0);
    setStage(0);
    setTopicSelected(false);
    setSelectedStance(false);
    setDrafted(false);
    setDraftRewritten(false);
    setCriticRound(0);
    setScoreRound(0);
    setOauthLoggedIn(false);
    setDagStatusText("等待用户运行");
    setCacheState("等待选择领域");
    setIsRunning(false);
    setDraftLines([]);
    setTypingLine(null);
    updateDag([], null);
    updateTrace("idle");
    setCostStage("idle");
    setShowToast(false);
    setOutlineItems(LOCKED_OUTLINE);
    setOutlineData(null);
    setOriginalDraftLines([]);
    setCriticScores(null);
    setCriticSuggestions([]);
    setCriticPass(null);
    setInsightNodes([]);
  }, [updateDag, updateTrace]);

  const [tokens, cost, ttft, cacheRate] = COST_TABLE[costStage] ?? COST_TABLE.idle;
  const scores = criticScores; // 只显示真实 AI 评分，未运行或失败时为 null

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <div className="app-grid">
      {/* ── 顶栏 ── */}
      <header className="topbar">
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, color: "var(--blue)", fontSize: 24, whiteSpace: "nowrap" }}>
          <div style={{ width: 34, height: 34, borderRadius: "var(--radius)", display: "grid", placeItems: "center", color: "#fff", background: "var(--blue)", boxShadow: "0 6px 16px rgba(0,132,255,0.2)" }}>
            <Radar size={18} />
          </div>
          <span>知创雷达</span>
        </div>

        {/* 领域 Tabs */}
        <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {DOMAINS.map((d) => (
            <button
              key={d}
              onClick={() => selectDomain(d)}
              style={{
                height: 36, padding: "0 14px", borderRadius: "var(--radius)",
                background: domain === d ? "var(--blue-50)" : "transparent",
                color: domain === d ? "var(--blue)" : "#4b5563",
                border: domain === d ? "1px solid rgba(0,132,255,0.22)" : "1px solid transparent",
                fontWeight: 650, transition: "160ms ease", cursor: "pointer",
              }}
            >
              {d}
            </button>
          ))}
        </nav>

        {/* 右侧操作 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <div style={{ height: 38, width: 210, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 999, color: "var(--muted)", background: "var(--soft)", fontSize: 13 }}>
            <Search size={15} /><span>搜索知乎热榜、问题、话题</span>
          </div>
          <button className="ghost-btn" onClick={resetDemo} disabled={isRunning}>
            <RotateCcw size={15} />重置演示
          </button>
          <button className="primary-btn" onClick={stage === 1 && topicSelected ? runPipeline : runPipeline} disabled={isRunning || !topicSelected}>
            <Play size={15} />运行 Agent
          </button>
          {oauthLoggedIn && authUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} title={authUser.name}>
              {authUser.avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={authUser.avatar} alt="avatar" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--blue)" }} />
                : <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--blue)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14 }}>{authUser.name[0]}</div>
              }
            </div>
          ) : (
            <button
              style={{ height: 34, padding: "0 14px", borderRadius: 999, background: "var(--blue)", color: "#fff", border: "none", fontWeight: 650, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              onClick={openLoginPopup}
            >
              <KeyRound size={14} />登录知乎
            </button>
          )}
        </div>
      </header>

      {/* ── 三栏工作区 ── */}
      <main className="workspace">
        {/* ── 左栏：选题池 ── */}
        <aside className="panel" style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
          <div className="panel-head">
            <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
              <Layers3 size={18} />选题池
            </div>
            <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 560 }}>
              {isFetchingTopics && currentTopics.length === 0
                ? "正在抓取今日热榜…"
                : domain
                  ? `今日热点 ${currentTopics.length} 条`
                  : cacheState}
            </span>
          </div>
          <div
            className="topic-list"
            style={{ padding: 12, overflowY: "auto" }}
          >
            {!domain ? (
              <LockedPanel icon={<MousePointerClick size={28} />} title="先选领域" desc="选择 AI 产品、职场、情感、科技或故事后，Trend Agent 才会生成对应选题池。" />
            ) : isFetchingTopics && currentTopics.length === 0 ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                <RefreshCw size={18} style={{ display: "inline-block", marginBottom: 8, opacity: 0.5, animation: "spin 1s linear infinite" }} /><br />
                Trend Agent 正在抓取今日热榜并分类…
              </div>
            ) : topicFetchError && currentTopics.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center" }}>
                <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{topicFetchError}</div>
                <button
                  className="ghost-btn sm-btn"
                  onClick={() => {
                    setTopicFetchError(null);
                    setHasMoreHot(true);
                  }}
                >
                  <RefreshCw size={13} /> 重试
                </button>
              </div>
            ) : (
              <>
                {currentTopics.map((topic, index) => (
                  <TopicCardItem
                    key={topic.id}
                    topic={topic}
                    active={topicSelected && index === topicIndex}
                    onClick={() => selectTopic(index)}
                  />
                ))}
                {/* 加载更多 */}
                {isFetchingTopics ? (
                  <div style={{ padding: "12px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                    <RefreshCw size={14} style={{ display: "inline-block", marginRight: 4, opacity: 0.5, animation: "spin 1s linear infinite" }} />
                    加载更多热点…
                  </div>
                ) : (
                  <>
                    {topicFetchError && (
                      <div style={{ padding: "4px 0 6px", textAlign: "center", color: "#ef4444", fontSize: 12 }}>
                        {topicFetchError}
                      </div>
                    )}
                    {hasMoreHot ? (
                      <button
                        className="ghost-btn"
                        style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                        onClick={() => loadMoreTopics(false)}
                      >
                        <RefreshCw size={13} />显示更多热点
                      </button>
                    ) : (
                      <button
                        className="ghost-btn"
                        style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                        onClick={() => loadMoreTopics(true)}
                      >
                        <RefreshCw size={13} />刷新获取最新热点
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── 中栏 ── */}
        <section style={{ display: "grid", gridTemplateRows: "auto auto 1fr", gap: 16, minWidth: 0 }}>
          {/* Hero Strip */}
          <div className="hero-strip">
            <div>
              <div style={{ color: "var(--blue)", fontWeight: 780, fontSize: 13, marginBottom: 8 }}>知乎创作者 AI 工作台</div>
              <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>从选题判断到发布体检，把 3 小时压缩到 30 分钟</h1>
              <p style={{ margin: "8px 0 0", color: "#5b6472", lineHeight: 1.6, fontSize: 14 }}>5-Agent 协作完成热榜聚类、观点地图、知乎式大纲、流式草稿与 Critic 自反馈，保留人的判断，不做一键内容工厂。</p>
            </div>
            <div style={{ height: 76, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, alignItems: "end" }}>
              <div className="bar" style={{ height: 42, minHeight: 24, borderRadius: "6px 6px 2px 2px", background: "linear-gradient(180deg,rgba(0,132,255,0.9),rgba(0,132,255,0.2))", border: "1px solid rgba(0,132,255,0.22)" }} />
              <div style={{ height: 52, minHeight: 24, borderRadius: "6px 6px 2px 2px", background: "linear-gradient(180deg,rgba(22,163,74,0.82),rgba(22,163,74,0.16))", border: "1px solid rgba(22,163,74,0.18)" }} />
              <div style={{ height: 34, minHeight: 24, borderRadius: "6px 6px 2px 2px", background: "linear-gradient(180deg,rgba(245,158,11,0.82),rgba(245,158,11,0.16))", border: "1px solid rgba(245,158,11,0.2)" }} />
              <div style={{ height: 68, minHeight: 24, borderRadius: "6px 6px 2px 2px", background: "linear-gradient(180deg,rgba(0,132,255,0.9),rgba(0,132,255,0.2))", border: "1px solid rgba(0,132,255,0.22)" }} />
              <div style={{ height: 44, minHeight: 24, borderRadius: "6px 6px 2px 2px", background: "linear-gradient(180deg,rgba(100,116,139,0.66),rgba(100,116,139,0.12))", border: "1px solid rgba(100,116,139,0.18)" }} />
            </div>
          </div>

          {/* DAG Panel */}
          <div className="panel" style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
                <GitBranch size={18} />5-Agent DAG 执行器
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{dagStatusText}</span>
            </div>
            {/* DAG Nodes */}
            <div className="dag-flow">
              {AGENT_DEFS.map((agent) => {
                const status = dagNodeStatus[agent.key] ?? "waiting";
                return (
                  <div key={agent.key} className={`dag-node ${status}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 760, fontSize: 13, marginBottom: 8, color: status === "waiting" ? "#64748b" : "inherit" }}>
                      <agent.icon size={15} />
                      {agent.name}
                    </div>
                    <p style={{ margin: 0, color: "#64748b", lineHeight: 1.45, fontSize: 12 }}>{agent.desc}</p>
                    <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 11 }}>{agent.model}</p>
                  </div>
                );
              })}
            </div>
            {/* Stepper */}
            <div className="stepper">
              {STEPS.map((step, i) => (
                <div key={i} className={`step-item ${i < stage ? "done" : i === stage ? "active" : ""}`}>
                  <strong>{step.title}</strong>
                  <span>{step.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stage Workbench */}
          <div style={{ minHeight: 0 }}>
            <div className="panel" style={{ minHeight: 0, overflow: "hidden", display: "grid", gridTemplateRows: "auto 1fr" }}>
              <StagePanel
                stage={stage}
                domain={domain}
                activeTopic={activeTopic}
                topicSelected={topicSelected}
                selectedStance={selectedStance}
                drafted={drafted}
                draftRewritten={draftRewritten}
                criticRound={criticRound}
                draftLines={draftLines}
                typingLine={typingLine}
                isRunning={isRunning}
                onSelectDomain={selectDomain}
                onRunPipeline={runPipeline}
                onChooseStance={chooseStance}
                onGenerateDraft={generateDraft}
                onRunCritic={runCriticCheck}
                outlineItems={outlineItems}
                onOutlineChange={setOutlineItems}
                originalDraftLines={originalDraftLines}
                insightNodes={insightNodes}
                onDraftEdit={setDraftLines}
              />
            </div>
          </div>
        </section>

        {/* ── 右栏 ── */}
        <aside className="panel" style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
          <div className="panel-head">
            <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
              <ShieldCheck size={18} />Critic 体检
            </div>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {scoreRound === 0
                ? "未运行"
                : criticPass === true
                ? `第 ${scoreRound} 次 · 通过 ✓`
                : criticPass === false
                ? `第 ${scoreRound} 次 · 未通过`
                : `第 ${scoreRound} 次已完成`}
            </span>
          </div>
          <div style={{ overflowY: "auto", padding: 12 }}>
            {/* 评分卡 */}
            <section style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 14, background: "#fff", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631", fontSize: 14 }}>
                  <Activity size={16} />5 维度评分
                </div>
                {criticPass !== null && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99,
                    background: criticPass ? "var(--green-50)" : "var(--red-50)",
                    color: criticPass ? "var(--green)" : "var(--red)",
                    border: `1px solid ${criticPass ? "rgba(22,163,74,0.25)" : "rgba(239,68,68,0.25)"}`,
                  }}>
                    {criticPass ? "✓ 通过" : "✗ 未通过"}
                  </span>
                )}
              </div>
              {/* 评分行 */}
              {(scores ?? [
                { name: "AI味检测",   value: 0, tone: "warn", reason: "" },
                { name: "事实风险",   value: 0, tone: "warn", reason: "" },
                { name: "营销风险",   value: 0, tone: "good", reason: "" },
                { name: "标题党风险", value: 0, tone: "warn", reason: "" },
                { name: "答非所问",   value: 0, tone: "good", reason: "" },
              ]).map(({ name, value, tone, reason }) => (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div className="score-row" style={{ marginBottom: reason ? 2 : 0 }}>
                    <span>{name}</span>
                    <div className={`meter ${tone}`}>
                      <span className="meter-bar" style={{ width: `${value}%` }} />
                    </div>
                    <strong style={{
                      fontSize: 13,
                      color: tone === "good" ? "var(--green)" : tone === "bad" ? "var(--red)" : "#b45309",
                    }}>{value || "—"}</strong>
                  </div>
                  {reason ? (
                    <p style={{ margin: "0 0 0 86px", fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{reason}</p>
                  ) : null}
                </div>
              ))}
              {/* 建议区 */}
              {criticSuggestions.length > 0 ? (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: "var(--orange-50)", border: "1px solid #fed7aa" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>改进建议</p>
                  {criticSuggestions.map((s, i) => (
                    <p key={i} style={{ margin: "0 0 4px", fontSize: 12, color: "#7c2d12", lineHeight: 1.55 }}>
                      {i + 1}. {s}
                    </p>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 6, color: "#7c2d12", background: "var(--orange-50)", border: "1px solid #fed7aa", fontSize: 12, lineHeight: 1.55 }}>
                  {scoreRound === 0
                    ? "体检会按 5 个维度打分：AI 腔、事实风险、营销嫌疑、标题党、答非所问。有任一维度触发 high 风险则不通过。"
                    : "暂无改进建议，内容质量良好。"}
                </div>
              )}
              {/* 按钮 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <button className="primary-btn" style={{ width: "100%", justifyContent: "center" }} onClick={runCriticCheck} disabled={!drafted || isRunning}>
                  <ShieldCheck size={15} />运行体检
                </button>
                <button className="ghost-btn" style={{ width: "100%", justifyContent: "center" }} onClick={rewriteDraft} disabled={!drafted || isRunning}>
                  <RefreshCw size={15} />Critic 重写
                </button>
              </div>
              {stage >= 4 && (
                <div style={{ marginTop: 8 }}>
                  <button className="primary-btn" style={{ width: "100%", justifyContent: "center" }} onClick={publish} disabled={isRunning}>
                    <Send size={15} />发布到知乎
                  </button>
                </div>
              )}
            </section>

            {/* 成本面板 */}
            <section style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 14, background: "#fff", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631", fontSize: 14 }}>
                <Gauge size={16} />智能路由成本面板
              </div>
              <div className="cost-grid">
                <div className="cost-item"><strong>{tokens.toLocaleString()}</strong><span>累计 Tokens</span></div>
                <div className="cost-item"><strong>{cost}</strong><span>本次成本</span></div>
                <div className="cost-item"><strong>{ttft}</strong><span>TTFT</span></div>
                <div className="cost-item"><strong>{cacheRate}</strong><span>Cache 命中</span></div>
              </div>
            </section>

            {/* Trace 列表 */}
            <section style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 14, background: "#fff", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631", fontSize: 14 }}>
                <ListTree size={16} />节点级 Trace
              </div>
              <ul className="trace-list">
                {traceEntries.map((entry) => (
                  <li key={entry.key}>
                    <span className={`trace-dot ${entry.status === "done" ? "done" : entry.status === "running" ? "running" : entry.status === "rewrite" ? "rewrite" : ""}`} />
                    <span>{entry.name} · {entry.model}</span>
                    <span style={{ color: "var(--muted)" }}>{entry.ms ?? "等待"}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 发布卡 */}
            {stage >= 4 && (
              <section style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: 14, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631", fontSize: 14 }}>
                  <PlugZap size={16} />知乎 OpenAPI 闭环
                </div>
                <p style={{ margin: "8px 0 12px", color: "#64748b", lineHeight: 1.55, fontSize: 13 }}>
                  OAuth 登录后调用 <span className="kbd">POST /openapi/publish/pin</span>。演示模式会模拟发布成功。
                </p>
                {oauthLoggedIn && authUser ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius)", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                    {authUser.avatar && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={authUser.avatar} alt="avatar" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                    )}
                    <span style={{ flex: 1, fontSize: 13, color: "#15803d", fontWeight: 600 }}>{authUser.name}</span>
                    <button
                      className="ghost-btn"
                      style={{ padding: "2px 10px", fontSize: 12 }}
                      onClick={() => logout().then(() => { setOauthLoggedIn(false); setAuthUser(null); })}
                    >退出</button>
                  </div>
                ) : (
                  <button
                    className="ghost-btn"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={openLoginPopup}
                  >
                    <KeyRound size={15} />知乎 OAuth 登录
                  </button>
                )}
              </section>
            )}
          </div>
        </aside>
      </main>

      {/* Toast */}
      <div className={`toast ${showToast ? "show" : ""}`}>
        <strong>发布成功</strong>
        <div style={{ marginTop: 4, color: "#047857", fontSize: 13, lineHeight: 1.5 }}>
          已通过演示模式写入知乎想法草稿，保留人工确认环节。
        </div>
      </div>
    </div>
  );
}

// ── 选题卡子组件 ─────────────────────────────────────────

function TopicCardItem({ topic, active, onClick }: {
  topic: ProtoTopicCard; active: boolean; onClick: () => void;
}) {
  return (
    <button className={`topic-card ${active ? "active" : ""}`} onClick={onClick}>
      <h2 style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 780, margin: "0 0 10px", color: "#202631" }}>
        {topic.title}
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span className="badge badge-blue" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {topic.source}
        </span>
        <span className="badge badge-green">知乎适配度 {topic.fitScore * 18 + 2}</span>
        <span className="badge badge-orange">竞争度 {topic.competition}</span>
      </div>
      <p style={{ margin: 0, color: "#526071", fontSize: 13, lineHeight: 1.5 }}>{topic.angle}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <div className="metric-pill"><strong>{topic.demand ?? "—"}</strong><span>需求信号</span></div>
        <div className="metric-pill"><strong>{topic.gap ?? "—"}</strong><span>内容缺口</span></div>
      </div>
    </button>
  );
}

// ── 锁定占位子组件 ───────────────────────────────────────

function LockedPanel({ icon, title, desc, style }: {
  icon: React.ReactNode; title: string; desc: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="locked-panel" style={style}>
      <div>
        {icon}
        <strong>{title}</strong>
        <p>{desc}</p>
      </div>
    </div>
  );
}

// ── 阶段工作台子组件 ─────────────────────────────────────

interface StagePanelProps {
  stage: Stage;
  domain: Domain | null;
  activeTopic: ProtoTopicCard | null;
  topicSelected: boolean;
  selectedStance: boolean;
  drafted: boolean;
  draftRewritten: boolean;
  criticRound: number;
  draftLines: string[];
  typingLine: string | null;
  isRunning: boolean;
  onSelectDomain: (d: Domain) => void;
  onRunPipeline: () => void;
  onChooseStance: (stance: string) => void;
  onGenerateDraft: () => void;
  onRunCritic: () => void;
  outlineItems: string[];
  onOutlineChange: (items: string[]) => void;
  originalDraftLines: string[];
  insightNodes: InsightNode[];
  onDraftEdit: (lines: string[]) => void;
}

function StagePanel(props: StagePanelProps) {
  const {
    stage, domain, activeTopic, topicSelected, selectedStance,
    drafted, draftRewritten, criticRound,
    draftLines, typingLine, isRunning,
    onSelectDomain, onRunPipeline, onChooseStance, onGenerateDraft, onRunCritic,
    outlineItems, onOutlineChange, originalDraftLines, insightNodes, onDraftEdit,
  } = props;

  const DOMAINS_LIST: Domain[] = ["AI产品", "职场", "情感", "科技", "故事"];

  // Stage 0: 选领域
  if (stage === 0) {
    return (
      <>
        <div className="panel-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
            <MousePointerClick size={18} />Step 1 · 选择领域
          </div>
        </div>
        <div style={{ padding: 16, overflowY: "auto", minHeight: 520 }}>
          <LockedPanel icon={<Radar size={30} />} title="先选择一个创作领域" desc="选完领域后，系统才会生成该领域的知乎选题池。后续观点地图、大纲、草稿和体检都不会提前展示。" style={{ minHeight: 250 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 18 }}>
            {DOMAINS_LIST.map((d) => (
              <button
                key={d}
                onClick={() => onSelectDomain(d)}
                style={{ minHeight: 92, padding: 14, textAlign: "left", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "#fff", transition: "160ms ease", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,132,255,0.36)"; e.currentTarget.style.background = "var(--blue-50)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "none"; }}
              >
                <strong style={{ display: "block", fontSize: 15, marginBottom: 8, color: "#202631" }}>{d}</strong>
                <span style={{ color: "#64748b", lineHeight: 1.5, fontSize: 12 }}>生成 {d} 方向的 5 张候选选题卡</span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  // Stage 1: 选题池
  if (stage === 1) {
    return (
      <>
        <div className="panel-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
            <Layers3 size={18} />Step 2 · 选题池
          </div>
          {topicSelected && (
            <button className="primary-btn sm-btn" onClick={onRunPipeline} disabled={isRunning}>
              <Play size={14} />运行 Agent
            </button>
          )}
        </div>
        <div style={{ padding: 16, overflowY: "auto", minHeight: 520 }}>
          {!topicSelected ? (
            <LockedPanel icon={<ListFilter size={30} />} title={`${domain} 选题池已生成`} desc='从左侧选题池选择一个题目。选中后再点击"运行 Agent"，系统才会进入观点地图。' style={{ minHeight: 360 }} />
          ) : activeTopic ? (
            <>
              <div style={{ padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--soft)", marginBottom: 14 }}>
                <span className="badge badge-blue">已选题</span>
                <h3 style={{ margin: "8px 0", fontSize: 18 }}>{activeTopic.title}</h3>
                <p style={{ margin: 0, color: "#64748b", lineHeight: 1.65, fontSize: 13 }}>{activeTopic.angle}</p>
              </div>
              <LockedPanel icon={<GitBranch size={30} />} title="准备生成观点地图" desc='点击"运行 Agent"后，上方 DAG 进度条会推进到 Insight 节点。执行结束后才展示观点地图。' style={{ minHeight: 320 }} />
            </>
          ) : null}
        </div>
      </>
    );
  }

  // Stage 2: 观点地图
  if (stage === 2) {
    // 提取正反立场节点
    const coreNode = insightNodes[0];
    const stanceNodes = (coreNode?.children ?? []).filter(n => n.type === "pro" || n.type === "con");

    return (
      <>
        <div className="panel-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
            <Network size={18} />Step 3 · 观点地图
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>选择下方立场后自动生成大纲</span>
        </div>
        <div style={{ padding: 16, overflowY: "auto", minHeight: 520 }}>
          {activeTopic && (
            <div style={{ padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--soft)", marginBottom: 14 }}>
              <span className="badge badge-blue">当前选题</span>
              <h3 style={{ margin: "8px 0", fontSize: 18 }}>{activeTopic.title}</h3>
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.65, fontSize: 13 }}>先看正反观点、读者疑问、常见误区和案例素材，再确认自己的核心立场。</p>
            </div>
          )}
          <Mindmap nodes={insightNodes} stanceSelected={selectedStance} />

          {/* 立场选择区 */}
          <div style={{ padding: "14px 0 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <MousePointerClick size={15} style={{ color: "var(--blue)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#202631" }}>选择主立场，AI 将以此生成大纲</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {stanceNodes.length > 0 ? stanceNodes.map((node) => {
                const isPro = node.type === "pro";
                return (
                  <button
                    key={node.id}
                    onClick={() => onChooseStance(node.label)}
                    disabled={isRunning}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      borderRadius: "var(--radius)",
                      border: `1px solid ${isPro ? "rgba(22,163,74,0.3)" : "rgba(239,68,68,0.3)"}`,
                      background: isPro ? "var(--green-50)" : "var(--red-50)",
                      cursor: "pointer", transition: "160ms ease",
                      display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      marginTop: 1,
                      color: isPro ? "var(--green)" : "var(--red)",
                      background: isPro ? "rgba(22,163,74,0.12)" : "rgba(239,68,68,0.12)",
                      border: `1px solid ${isPro ? "rgba(22,163,74,0.25)" : "rgba(239,68,68,0.25)"}`,
                      whiteSpace: "nowrap",
                    }}>{isPro ? "支持" : "反对"}</span>
                    <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>{node.label}</span>
                  </button>
                );
              }) : (
                /* 观点还未加载完时，显示骨架 + 默认立场按钮 */
                <>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ height: 52, borderRadius: "var(--radius)", background: "#f1f5f9", border: "1px solid var(--line)" }} />
                  ))}
                </>
              )}
              {/* 兜底：使用选题默认立场 */}
              {activeTopic && (
                <button
                  onClick={() => onChooseStance(activeTopic.angle)}
                  disabled={isRunning}
                  className="ghost-btn"
                  style={{ justifyContent: "flex-start", width: "100%" }}
                >
                  <MousePointerClick size={13} />
                  使用选题默认立场：{activeTopic.angle.slice(0, 28)}{activeTopic.angle.length > 28 ? "…" : ""}
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // Stage 3: 大纲与草稿
  if (stage === 3) {
    return (
      <>
        <div className="panel-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
            <FilePenLine size={18} />Step 4 · 大纲与草稿
          </div>
          <button className="primary-btn sm-btn" onClick={onGenerateDraft} disabled={isRunning}>
            <WandSparkles size={14} />流式生成
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 520 }}>
          <OutlineArea items={outlineItems} editable={selectedStance} onChange={onOutlineChange} />
          <DraftArea lines={draftLines} typingLine={typingLine} isRewritten={false} originalLines={originalDraftLines} onEdit={onDraftEdit} />
        </div>
      </>
    );
  }

  // Stage 4: Critic 体检
  return (
    <>
      <div className="panel-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 780, color: "#202631" }}>
          <ShieldCheck size={18} />Step 5 · Critic 体检
        </div>
        <button className="primary-btn sm-btn" onClick={onRunCritic} disabled={isRunning || !drafted}>
          <ShieldCheck size={14} />运行体检
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 520 }}>
        <OutlineArea items={outlineItems} editable={true} onChange={onOutlineChange} />
        <DraftArea lines={draftLines} typingLine={typingLine} isRewritten={draftRewritten} originalLines={originalDraftLines} onEdit={onDraftEdit} />
      </div>
    </>
  );
}

// ── 思维导图（模板式网格布局） ────────────────────────────

const INSIGHT_TYPE_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  core:     { label: "核心议题", color: "var(--blue)",   bg: "var(--blue-50)",   border: "rgba(0,132,255,0.3)" },
  pro:      { label: "支持观点", color: "var(--green)",  bg: "var(--green-50)",  border: "rgba(22,163,74,0.25)" },
  con:      { label: "反对观点", color: "var(--red)",    bg: "var(--red-50)",    border: "rgba(239,68,68,0.25)" },
  question: { label: "读者疑问", color: "#b45309",       bg: "var(--orange-50)", border: "rgba(245,158,11,0.3)" },
  myth:     { label: "常见误区", color: "#7c3aed",       bg: "#f5f3ff",          border: "rgba(124,58,237,0.25)" },
  case:     { label: "案例素材", color: "#0891b2",       bg: "#ecfeff",          border: "rgba(8,145,178,0.25)" },
};

// 固定模板：6个子槽位
const SLOT_TEMPLATE: Array<"pro" | "con" | "question" | "myth"> = [
  "pro", "pro", "con",
  "question", "question", "myth",
];

function InsightCard({ type, label, highlight }: { type: string; label?: string; highlight?: boolean }) {
  const cfg = INSIGHT_TYPE_CFG[type] ?? INSIGHT_TYPE_CFG.pro;
  const empty = !label;
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "var(--radius)",
      border: `1px solid ${highlight ? cfg.border : empty ? "#e2e8f0" : cfg.border}`,
      background: empty ? "#f8fafc" : cfg.bg,
      outline: highlight ? `3px solid ${cfg.border}` : "none",
      transition: "160ms ease",
      minHeight: 72,
    }}>
      <span style={{
        display: "inline-block", marginBottom: 6,
        fontSize: 11, fontWeight: 700, color: empty ? "#94a3b8" : cfg.color,
        background: empty ? "#f1f5f9" : `${cfg.bg}`,
        border: `1px solid ${empty ? "#e2e8f0" : cfg.border}`,
        borderRadius: 99, padding: "1px 8px",
      }}>{cfg.label}</span>
      {empty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ height: 10, borderRadius: 4, background: "#e2e8f0", width: "85%" }} />
          <div style={{ height: 10, borderRadius: 4, background: "#e2e8f0", width: "60%" }} />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>{label}</p>
      )}
    </div>
  );
}

function Mindmap({ nodes, stanceSelected }: { nodes: InsightNode[]; stanceSelected: boolean }) {
  const coreNode = nodes[0];
  const children = coreNode?.children ?? [];

  // 按类型分桶，每种类型按顺序取
  const buckets: Record<string, string[]> = { pro: [], con: [], question: [], myth: [], case: [] };
  children.forEach(c => { buckets[c.type]?.push(c.label); });
  const cursors: Record<string, number> = { pro: 0, con: 0, question: 0, myth: 0 };

  const slotLabels = SLOT_TEMPLATE.map(type => {
    const label = buckets[type]?.[cursors[type]];
    cursors[type]++;
    return label;
  });

  return (
    <div style={{ padding: "0 16px 16px" }}>
      {/* 核心议题 */}
      <div style={{
        padding: "14px 18px", marginBottom: 10,
        borderRadius: "var(--radius)",
        border: "1px solid rgba(0,132,255,0.3)",
        background: "linear-gradient(90deg, var(--blue-50), #fff)",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--blue)",
          background: "rgba(0,132,255,0.1)", border: "1px solid rgba(0,132,255,0.2)",
          borderRadius: 99, padding: "2px 10px",
        }}>核心议题</span>
        {coreNode ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#202631" }}>{coreNode.label}</span>
        ) : (
          <div style={{ height: 14, borderRadius: 4, background: "#dbeafe", width: 220 }} />
        )}
      </div>

      {/* 第一行：支持观点 × 2 + 反对观点 × 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        {[0, 1, 2].map(i => (
          <InsightCard
            key={i}
            type={SLOT_TEMPLATE[i]}
            label={slotLabels[i]}
            highlight={stanceSelected && SLOT_TEMPLATE[i] === "con"}
          />
        ))}
      </div>

      {/* 第二行：读者疑问 × 2 + 常见误区 × 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[3, 4, 5].map(i => (
          <InsightCard
            key={i}
            type={SLOT_TEMPLATE[i]}
            label={slotLabels[i]}
            highlight={false}
          />
        ))}
      </div>

      {!coreNode && (
        <p style={{ marginTop: 12, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
          点击「运行 Agent」后 AI 将填充以上所有卡片
        </p>
      )}
    </div>
  );
}

// ── 大纲区域 ─────────────────────────────────────────────

function OutlineArea({ items, editable, onChange }: {
  items: string[];
  editable?: boolean;
  onChange?: (items: string[]) => void;
}) {
  if (!editable) {
    return (
      <div className="outline-area">
        <span className="badge badge-blue">知乎式回答结构</span>
        <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: "#4b5563", lineHeight: 1.7, fontSize: 13 }}>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ol>
      </div>
    );
  }

  return (
    <div className="outline-area">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="badge badge-blue">知乎式回答结构</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>点击条目可直接修改</span>
      </div>
      <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: "#4b5563", lineHeight: 1.7, fontSize: 13 }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 4 }}>
            <textarea
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange?.(next);
              }}
              rows={Math.max(1, Math.ceil(item.length / 38))}
              style={{
                flex: 1, resize: "none", border: "1px solid transparent",
                background: "transparent", fontSize: 13, lineHeight: 1.6,
                fontFamily: "inherit", padding: "1px 6px", borderRadius: 4,
                outline: "none", overflow: "hidden", transition: "border-color 120ms, background 120ms",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,132,255,0.4)";
                e.currentTarget.style.background = "rgba(0,132,255,0.04)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.background = "transparent";
              }}
            />
            <button
              onClick={() => onChange?.(items.filter((_, j) => j !== i))}
              title="删除"
              style={{ color: "#cbd5e1", background: "none", border: "none", cursor: "pointer", padding: "4px 2px", fontSize: 15, lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#cbd5e1"; }}
            >×</button>
          </li>
        ))}
      </ol>
      <button
        onClick={() => onChange?.([...items, ""])}
        style={{
          marginTop: 6, marginLeft: 20, fontSize: 12, color: "var(--blue)",
          background: "none", border: "1px dashed rgba(0,132,255,0.4)",
          borderRadius: 4, padding: "3px 10px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >+ 添加条目</button>
    </div>
  );
}

// ── 草稿区域 ─────────────────────────────────────────────

function DraftArea({ lines, typingLine, isRewritten, originalLines, onEdit }: {
  lines: string[]; typingLine: string | null; isRewritten: boolean;
  originalLines?: string[]; onEdit?: (lines: string[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"current" | "original">("current");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasOriginal = (originalLines?.length ?? 0) > 0;
  const isEmpty = lines.length === 0 && typingLine === null;
  const isStreaming = typingLine !== null;
  const canEdit = !isEmpty && !isStreaming && tab === "current" && !!onEdit;

  useEffect(() => {
    if (lines.length > 0) setTab("current");
    // 若正在编辑时 AI 重写了内容，退出编辑
    if (editing && lines.length > 0) setEditing(false);
  }, [lines.length]); // eslint-disable-line

  useEffect(() => {
    if (tab === "current" && ref.current && !editing) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines, typingLine, tab, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      // 自动撑开高度
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const enterEdit = () => {
    setEditText(lines.join("\n\n"));
    setEditing(true);
  };

  const saveEdit = () => {
    const newLines = editText.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    onEdit?.(newLines);
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  const displayLines = tab === "original" && hasOriginal ? originalLines! : lines;
  const displayTyping = tab === "current" ? typingLine : null;

  return (
    <div className="draft-area" ref={ref}>
      {/* 版本 tabs + 编辑按钮 */}
      {!isEmpty && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {hasOriginal && (["current", "original"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setEditing(false); }}
                style={{
                  fontSize: 12, padding: "3px 12px", borderRadius: 99, cursor: "pointer",
                  fontWeight: tab === t ? 660 : 440, transition: "120ms ease",
                  background: tab === t ? "var(--blue)" : "var(--soft)",
                  color: tab === t ? "#fff" : "var(--muted)",
                  border: "1px solid " + (tab === t ? "var(--blue)" : "var(--line)"),
                }}
              >
                {t === "current" ? "重写版" : "原版草稿"}
              </button>
            ))}
          </div>
          {canEdit && !editing && (
            <button
              onClick={enterEdit}
              style={{
                fontSize: 12, padding: "3px 12px", borderRadius: 99, cursor: "pointer",
                background: "var(--soft)", color: "#475569",
                border: "1px solid var(--line)", transition: "120ms ease",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,132,255,0.4)"; e.currentTarget.style.color = "var(--blue)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "#475569"; }}
            >
              ✏ 人工修改
            </button>
          )}
          {editing && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={saveEdit}
                style={{
                  fontSize: 12, padding: "3px 12px", borderRadius: 99, cursor: "pointer",
                  background: "var(--blue)", color: "#fff",
                  border: "1px solid var(--blue)", fontWeight: 660,
                }}
              >
                ✓ 保存
              </button>
              <button
                onClick={cancelEdit}
                style={{
                  fontSize: 12, padding: "3px 12px", borderRadius: 99, cursor: "pointer",
                  background: "var(--soft)", color: "var(--muted)",
                  border: "1px solid var(--line)",
                }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}

      {isEmpty ? (
        <>
          <h3>等待生成草稿</h3>
          <p>点击"流式生成"后，上方进度条推进到 Draft。草稿完成后，右侧才解锁 Critic 体检。</p>
        </>
      ) : editing ? (
        /* 编辑模式 */
        <>
          <h3 style={{ marginBottom: 10 }}>{isRewritten ? "重写后草稿" : "草稿初版"}<span style={{ marginLeft: 8, fontSize: 11, fontWeight: 440, color: "var(--blue)", background: "var(--blue-50)", padding: "2px 8px", borderRadius: 99 }}>编辑中</span></h3>
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = e.currentTarget.scrollHeight + "px";
            }}
            style={{
              width: "100%", minHeight: 320, padding: "10px 12px",
              border: "1px solid rgba(0,132,255,0.35)", borderRadius: "var(--radius)",
              background: "rgba(0,132,255,0.02)", fontSize: 14, lineHeight: 1.82,
              fontFamily: "inherit", color: "#2f3744", resize: "none",
              outline: "none", boxSizing: "border-box", overflow: "hidden",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,132,255,0.6)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(0,132,255,0.35)"; }}
            placeholder="在此编辑草稿内容，段落间空一行…"
          />
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>段落间空一行分隔，点击「保存」后更新正文</p>
        </>
      ) : (
        /* 阅读模式 */
        <>
          <h3>
            {tab === "original"
              ? "草稿原版"
              : isRewritten ? "重写后草稿" : "草稿初版"}
            {tab === "original" && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 440, color: "var(--muted)", background: "var(--soft)", padding: "2px 8px", borderRadius: 99 }}>历史版本</span>
            )}
          </h3>
          {displayLines.map((line, i) => <p key={i}>{line}</p>)}
          {displayTyping !== null && (
            <p className="typing-cursor" id="typingLine">{displayTyping}</p>
          )}
        </>
      )}
    </div>
  );
}
