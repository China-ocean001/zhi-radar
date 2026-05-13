/**
 * 简易 Eval Harness
 * 使用 10 条测试用例，LLM 自动打分，输出 HTML 报告
 * 运行命令：npm run eval
 */

import { generateObject } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ─── 使用 mock 模式 ────────────────────────────────────────
process.env.NEXT_PUBLIC_MOCK_MODE = "false";

// 动态导入 agents（避免 Next.js server-only 问题）
async function getAgents() {
  const { runTrendAgent } = await import("../agents/trend");
  const { runCriticAgent } = await import("../agents/critic");
  return { runTrendAgent, runCriticAgent };
}

// ─── 测试用例 ──────────────────────────────────────────────

interface TestCase {
  id: string;
  description: string;
  input: unknown;
  expected: string; // 期望的核心特征描述
}

const TEST_CASES: TestCase[] = [
  {
    id: "trend-ai-1",
    description: "AI产品领域选题生成：应返回5张选题卡",
    input: { domain: "AI产品" },
    expected: "返回恰好5张选题卡，每张包含title/fitScore/competition/angle字段",
  },
  {
    id: "trend-job-1",
    description: "职场领域选题生成：竞争度字段有效",
    input: { domain: "职场" },
    expected: "competition字段均为「低」「中」「高」之一",
  },
  {
    id: "trend-em-1",
    description: "情感领域选题：fitScore在1-5范围内",
    input: { domain: "情感" },
    expected: "所有fitScore在1到5之间（含）",
  },
  {
    id: "trend-tech-1",
    description: "科技领域选题：标题应含科技相关词汇",
    input: { domain: "科技" },
    expected: "至少3张选题标题与科技/数字/产品相关",
  },
  {
    id: "trend-story-1",
    description: "故事领域选题：标题应有叙事感",
    input: { domain: "故事" },
    expected: "标题有故事性，含人称代词或时间词",
  },
  {
    id: "critic-pass-1",
    description: "高质量文章应通过体检（>= 75分）",
    input: {
      topic: { id: "t1", title: "AI 正在重塑知识工作", domain: "AI产品", fitScore: 4, competition: "中", angle: "普通人视角", source: "测试" },
      draft: "最近和几个做内容的朋友聊，大家都在聊 AI 的事。有人说被它抢了饭碗，有人说靠它发了大财。\n\n其实，真正被 AI 淘汰的，不是那些用 AI 的人，而是那些拒绝思考的人。\n\nAI 是放大镜，它放大的是你已有的判断力和认知框架。没有框架的人，只会被淹没在更多的垃圾内容里。\n\n所以，与其焦虑被替代，不如问自己：我真正的不可替代性在哪里？\n\n欢迎在评论区聊聊，你用 AI 遇到的最大卡点是什么？",
      round: 1,
    },
    expected: "pass为true，totalScore >= 75",
  },
  {
    id: "critic-fail-1",
    description: "AI腔调文章应扣分（AI味检测低分）",
    input: {
      topic: { id: "t2", title: "AI 写作技巧", domain: "AI产品", fitScore: 3, competition: "低", angle: "技巧分享", source: "测试" },
      draft: "首先，我们需要了解AI写作的基本原理。其次，掌握提示词工程是非常重要的。第三，我们应该注意以下几点：1. 明确目标；2. 提供上下文；3. 迭代优化。总结来说，AI写作需要我们认真学习和实践。希望以上内容对您有所帮助！",
      round: 1,
    },
    expected: "AI味检测维度score <= 70，说明识别出机器腔调",
  },
  {
    id: "critic-fact-1",
    description: "含无来源数据应标记事实风险",
    input: {
      topic: { id: "t3", title: "AI 就业影响", domain: "职场", fitScore: 4, competition: "中", angle: "数据分析", source: "测试" },
      draft: "根据最新研究显示，AI将在未来5年内取代全球99%的白领工作，届时全球将有20亿人失业。这一趋势已经不可逆转，每个人都应该立即行动准备转型。",
      round: 1,
    },
    expected: "事实风险维度risk为mid或high，reason提及数据来源问题",
  },
  {
    id: "critic-marketing-1",
    description: "含明显广告语应标记营销风险",
    input: {
      topic: { id: "t4", title: "AI工具推荐", domain: "AI产品", fitScore: 3, competition: "高", angle: "工具评测", source: "测试" },
      draft: "这款革命性的AI工具是目前市面上最好的产品，没有之一！限时优惠，现在购买立减50%！点击链接立即购买，不买后悔！这是我见过最好的投资，绝对物超所值！",
      round: 1,
    },
    expected: "营销风险维度score <= 60，risk为high",
  },
  {
    id: "critic-offtopic-1",
    description: "答非所问文章应被识别",
    input: {
      topic: { id: "t5", title: "如何在职场提升影响力", domain: "职场", fitScore: 4, competition: "中", angle: "方法论", source: "测试" },
      draft: "今天来聊聊我最喜欢的咖啡品牌。瑞幸最近出了新品，味道非常好。喝咖啡可以提神，对工作很有帮助。咖啡文化在中国越来越流行，很多年轻人都喜欢喝咖啡。",
      round: 1,
    },
    expected: "答非所问维度score <= 60，reason提到内容与选题不符",
  },
];

// ─── LLM 打分器 ───────────────────────────────────────────

const { gateway } = await import("../lib/llm");

const EvalScoreSchema = z.object({
  score: z.number().min(0).max(100),
  pass: z.boolean(),
  reason: z.string(),
});

async function llmScore(
  testCase: TestCase,
  actualOutput: unknown
): Promise<{ score: number; pass: boolean; reason: string }> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  if (!gatewayUrl) {
    // 无 LLM 网关时用简单规则打分
    return simpleScore(testCase, actualOutput);
  }

  try {
    const { object } = await generateObject({
      model: gateway("gpt-4o-mini"),
      schema: EvalScoreSchema,
      prompt: `你是测试评分员。判断以下测试用例的实际输出是否符合期望。

测试描述：${testCase.description}
期望特征：${testCase.expected}

实际输出：
${JSON.stringify(actualOutput, null, 2)}

给出0-100分，pass表示是否达标（>= 70），reason简述判断依据。`,
    });
    return object;
  } catch {
    return simpleScore(testCase, actualOutput);
  }
}

function simpleScore(
  testCase: TestCase,
  actualOutput: unknown
): { score: number; pass: boolean; reason: string } {
  const str = JSON.stringify(actualOutput);

  // 规则式评分
  if (testCase.id.startsWith("trend-")) {
    const hasTopics = str.includes('"title"') && str.includes('"fitScore"');
    const score = hasTopics ? 85 : 30;
    return { score, pass: score >= 70, reason: hasTopics ? "返回了选题卡数据" : "缺少必要字段" };
  }

  if (testCase.id.startsWith("critic-")) {
    const hasDimensions = str.includes('"dimensions"') && str.includes('"totalScore"');
    const score = hasDimensions ? 80 : 20;
    return { score, pass: score >= 70, reason: hasDimensions ? "返回了评分数据" : "缺少评分维度" };
  }

  return { score: 60, pass: false, reason: "规则评分兜底" };
}

// ─── 运行 Harness ──────────────────────────────────────────

interface EvalResult {
  testCase: TestCase;
  actualOutput: unknown;
  score: number;
  pass: boolean;
  reason: string;
  durationMs: number;
  error?: string;
}

async function runEval(): Promise<void> {
  console.log("🚀 知创雷达 Eval Harness 启动\n");
  const { runTrendAgent, runCriticAgent } = await getAgents();

  const results: EvalResult[] = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`  测试 [${tc.id}] ${tc.description}... `);
    const start = Date.now();

    try {
      let output: unknown;

      if (tc.id.startsWith("trend-")) {
        output = await runTrendAgent(tc.input as Parameters<typeof runTrendAgent>[0]);
      } else if (tc.id.startsWith("critic-")) {
        output = await runCriticAgent(tc.input as Parameters<typeof runCriticAgent>[0]);
      } else {
        output = { error: "unknown test type" };
      }

      const { score, pass, reason } = await llmScore(tc, output);
      const duration = Date.now() - start;

      results.push({ testCase: tc, actualOutput: output, score, pass, reason, durationMs: duration });
      console.log(`${pass ? "✅" : "❌"} ${score}分 (${duration}ms)`);
    } catch (e) {
      const duration = Date.now() - start;
      const error = e instanceof Error ? e.message : String(e);
      results.push({
        testCase: tc, actualOutput: null, score: 0, pass: false,
        reason: "执行异常", durationMs: duration, error,
      });
      console.log(`💥 Error: ${error}`);
    }
  }

  // 统计
  const passCount = results.filter((r) => r.pass).length;
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  console.log(`\n✨ 完成: ${passCount}/${results.length} 通过，平均分 ${avgScore.toFixed(1)}`);

  // 生成 HTML 报告
  const reportPath = generateHtmlReport(results);
  console.log(`📊 报告已生成: ${reportPath}`);
}

function generateHtmlReport(results: EvalResult[]): string {
  const passCount = results.filter((r) => r.pass).length;
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;

  const rows = results.map((r) => `
    <tr class="${r.pass ? "pass" : "fail"}">
      <td><code>${r.testCase.id}</code></td>
      <td>${r.testCase.description}</td>
      <td class="score">${r.score}</td>
      <td>${r.pass ? "✅ 通过" : "❌ 不通过"}</td>
      <td>${r.reason}</td>
      <td>${r.durationMs}ms</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>知创雷达 Eval 报告</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #0084FF; }
    .summary { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: #f5f5f5; padding: 16px 24px; border-radius: 8px; text-align: center; }
    .stat .value { font-size: 2em; font-weight: bold; color: #0084FF; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #0084FF; color: white; padding: 10px; text-align: left; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
    tr.pass { background: #f0fff4; }
    tr.fail { background: #fff5f5; }
    .score { font-weight: bold; font-size: 1.1em; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  </style>
</head>
<body>
  <h1>🔍 知创雷达 Eval Harness 报告</h1>
  <p>生成时间：${new Date().toLocaleString("zh-CN")}</p>
  <div class="summary">
    <div class="stat"><div class="value">${passCount}/${results.length}</div><div>通过率</div></div>
    <div class="stat"><div class="value">${avgScore.toFixed(1)}</div><div>平均分</div></div>
    <div class="stat"><div class="value">${results.reduce((s, r) => s + r.durationMs, 0)}ms</div><div>总耗时</div></div>
  </div>
  <table>
    <thead><tr><th>ID</th><th>描述</th><th>得分</th><th>结果</th><th>评价</th><th>耗时</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  const reportPath = path.join(process.cwd(), "eval-report.html");
  fs.writeFileSync(reportPath, html);
  return reportPath;
}

runEval().catch(console.error);
