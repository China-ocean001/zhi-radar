/**
 * 自研 DAG 执行器（~250行）
 * 支持：节点依赖声明、并发执行、失败自动重试、状态回调
 * 禁止依赖 LangGraph 等外部编排框架
 */

// ─── 类型定义 ──────────────────────────────────────────────

export type NodeStatus = "idle" | "running" | "done" | "error" | "retry";

export interface DAGNodeDef<TInput = unknown, TOutput = unknown> {
  id: string;
  deps: string[];          // 依赖的节点 id 列表
  maxRetries?: number;     // 默认 2
  run: (input: TInput, context: DAGContext) => Promise<TOutput>;
}

export interface DAGContext {
  results: Record<string, unknown>;   // 已完成节点的输出
  onStatusChange?: (id: string, status: NodeStatus, meta?: Record<string, unknown>) => void;
}

export interface DAGRunResult {
  success: boolean;
  results: Record<string, unknown>;
  errors: Record<string, string>;
  durationMs: number;
}

// ─── 核心执行器 ───────────────────────────────────────────

export class DAGExecutor {
  private nodes: Map<string, DAGNodeDef>;
  private onStatusChange?: DAGContext["onStatusChange"];

  constructor(
    nodes: DAGNodeDef[],
    onStatusChange?: DAGContext["onStatusChange"]
  ) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.onStatusChange = onStatusChange;
  }

  async run(initialInput: unknown = {}): Promise<DAGRunResult> {
    const startTime = Date.now();
    const results: Record<string, unknown> = { __input: initialInput };
    const errors: Record<string, string> = {};
    const completed = new Set<string>();
    const failed = new Set<string>();

    const context: DAGContext = {
      results,
      onStatusChange: this.onStatusChange,
    };

    // 拓扑排序 — Kahn 算法
    const order = this.topologicalSort();
    if (!order) {
      return {
        success: false,
        results,
        errors: { __dag: "Cycle detected in DAG" },
        durationMs: Date.now() - startTime,
      };
    }

    // 按批次并发执行（同批内节点无依赖关系）
    const batches = this.buildBatches(order);

    for (const batch of batches) {
      // 跳过依赖失败的节点
      const runnable = batch.filter(
        (id) => !this.nodes.get(id)!.deps.some((dep) => failed.has(dep))
      );

      await Promise.all(
        runnable.map(async (id) => {
          const node = this.nodes.get(id)!;
          const maxRetries = node.maxRetries ?? 2;
          let lastError: Error | null = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const status: NodeStatus = attempt === 0 ? "running" : "retry";
            this.onStatusChange?.(id, status, { attempt });

            try {
              const output = await node.run(context.results, context);
              results[id] = output;
              completed.add(id);
              this.onStatusChange?.(id, "done");
              return;
            } catch (e) {
              lastError = e instanceof Error ? e : new Error(String(e));
              if (attempt < maxRetries) {
                // 指数退避
                await sleep(200 * 2 ** attempt);
              }
            }
          }

          // 所有重试耗尽
          failed.add(id);
          errors[id] = lastError?.message ?? "Unknown error";
          this.onStatusChange?.(id, "error", { error: errors[id] });
        })
      );
    }

    return {
      success: failed.size === 0,
      results,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /** Kahn 拓扑排序，返回 null 表示有环 */
  private topologicalSort(): string[] | null {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const [id] of this.nodes) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }

    for (const [id, node] of this.nodes) {
      for (const dep of node.deps) {
        adj.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }

    const queue = [...inDegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([id]) => id);

    const result: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    return result.length === this.nodes.size ? result : null;
  }

  /** 将拓扑序列分组成可并发批次 */
  private buildBatches(order: string[]): string[][] {
    const batches: string[][] = [];
    const levelOf = new Map<string, number>();

    for (const id of order) {
      const node = this.nodes.get(id)!;
      const level = node.deps.reduce(
        (max, dep) => Math.max(max, (levelOf.get(dep) ?? 0) + 1),
        0
      );
      levelOf.set(id, level);
      if (!batches[level]) batches[level] = [];
      batches[level].push(id);
    }

    return batches;
  }
}

/** 构建知创雷达的标准 5-Agent DAG */
export function buildZhiRadarDAG(
  agentRunners: Record<
    string,
    (input: unknown, ctx: DAGContext) => Promise<unknown>
  >,
  onStatusChange?: DAGContext["onStatusChange"]
): DAGExecutor {
  const nodes: DAGNodeDef[] = [
    {
      id: "trend",
      deps: [],
      maxRetries: 2,
      run: agentRunners.trend,
    },
    {
      id: "insight",
      deps: ["trend"],
      maxRetries: 2,
      run: agentRunners.insight,
    },
    {
      id: "outline",
      deps: ["insight"],
      maxRetries: 2,
      run: agentRunners.outline,
    },
    {
      id: "draft",
      deps: ["outline"],
      maxRetries: 1,
      run: agentRunners.draft,
    },
    {
      id: "critic",
      deps: ["draft"],
      maxRetries: 3,
      run: agentRunners.critic,
    },
  ];

  return new DAGExecutor(nodes, onStatusChange);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
