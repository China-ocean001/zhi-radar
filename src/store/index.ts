"use client";

import { create } from "zustand";
import type { AppState, DagNode, TraceEntry, CostStats } from "./types";

const AGENT_DEFS = [
  { id: "trend",   label: "Trend",   model: "DeepSeek V3",      status: "waiting" as const },
  { id: "insight", label: "Insight", model: "Claude Sonnet 4.6", status: "waiting" as const },
  { id: "outline", label: "Outline", model: "Claude Sonnet 4.6", status: "waiting" as const },
  { id: "draft",   label: "Draft",   model: "Claude Sonnet 4.6", status: "waiting" as const },
  { id: "critic",  label: "Critic",  model: "GPT-4o-mini",       status: "waiting" as const },
];

const INITIAL_COST: CostStats = {
  totalTokens: 0, totalCost: 0, ttft: 0, cacheRate: 0, agentBreakdown: {},
};

function buildInitialTrace(): TraceEntry[] {
  return AGENT_DEFS.map((a) => ({
    key: a.id, name: a.label, model: a.model, status: "waiting" as const,
  }));
}

export const useAppStore = create<AppState>((set, get) => ({
  domain: null,
  setDomain: (domain) => set({ domain }),

  topics: [],
  setTopics: (topics) => set({ topics }),
  topicIndex: 0,
  setTopicIndex: (topicIndex) => set({ topicIndex }),
  topicSelected: false,
  setTopicSelected: (v) => set({ topicSelected: v }),

  stage: 0,
  setStage: (stage) => set({ stage }),

  selectedStance: false,
  setSelectedStance: (v) => set({ selectedStance: v }),

  draft: "",
  setDraft: (draft) => set({ draft }),
  appendDraft: (chunk) => set((s) => ({ draft: s.draft + chunk })),
  drafted: false,
  setDrafted: (v) => set({ drafted: v }),
  draftRewritten: false,
  setDraftRewritten: (v) => set({ draftRewritten: v }),

  criticRound: 0,
  setCriticRound: (r) => set({ criticRound: r }),

  insightNodes: [],
  setInsightNodes: (n) => set({ insightNodes: n }),

  outline: null,
  setOutline: (o) => set({ outline: o }),

  dagNodes: AGENT_DEFS.map((a) => ({ ...a })),

  setDagProgress: (doneKeys, runningKey, rewrite = false) =>
    set((s) => ({
      dagNodes: s.dagNodes.map((n) => {
        if (doneKeys.includes(n.id)) return { ...n, status: "done" as const };
        if (n.id === runningKey)
          return { ...n, status: rewrite ? ("rewrite" as const) : ("running" as const) };
        return { ...n, status: "waiting" as const };
      }),
    })),

  resetDag: () =>
    set({ dagNodes: AGENT_DEFS.map((a) => ({ ...a })) }),

  traceEntries: buildInitialTrace(),
  setTraceEntries: (entries) => set({ traceEntries: entries }),

  costStats: INITIAL_COST,
  setCostStats: (patch) =>
    set((s) => ({ costStats: { ...s.costStats, ...patch } })),

  dagStatusText: "等待用户运行",
  setDagStatusText: (s) => set({ dagStatusText: s }),

  oauthLoggedIn: false,
  setOauthLoggedIn: (v) => set({ oauthLoggedIn: v }),

  user: null,
  setUser: (user) => set({ user }),

  resetAll: () =>
    set({
      domain: null,
      topicIndex: 0,
      topicSelected: false,
      stage: 0,
      selectedStance: false,
      draft: "",
      drafted: false,
      draftRewritten: false,
      criticRound: 0,
      insightNodes: [],
      outline: null,
      dagNodes: AGENT_DEFS.map((a) => ({ ...a })),
      traceEntries: buildInitialTrace(),
      costStats: INITIAL_COST,
      dagStatusText: "等待用户运行",
      oauthLoggedIn: false,
    }),
}));
