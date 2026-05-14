/**
 * 知乎 OpenAPI 封装
 * 包含：OAuth、热榜、搜索、发布想法
 * 优先使用 ZHIHU_ACCESS_TOKEN 环境变量；未配置时降级 mock
 */

const ZHIHU_BASE = "https://api.zhihu.com";
const APP_ID  = process.env.ZHIHU_APP_ID  || "";
const APP_KEY = process.env.ZHIHU_APP_KEY || "";

// ─── OAuth ────────────────────────────────────────────────

export function buildOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: APP_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "public read_user write_note",
    state,
  });
  return `https://www.zhihu.com/oauth/authorize?${params}`;
}

export async function exchangeToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${ZHIHU_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: APP_ID,
      client_secret: APP_KEY,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`OAuth exchange failed: ${res.status}`);
  return res.json();
}

// ─── 热榜 ──────────────────────────────────────────────────

export interface ZhihuHotItem {
  id: string;
  title: string;
  excerpt: string;
  heat: number;
}

/** 将各种热度文本（"2232 万热度" / 9800 / "9.8k"）统一转为数字 */
function parseHeat(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "");
  const match = s.match(/([\d.]+)\s*([万kKwW]?)/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "万" || unit === "w") return Math.round(n * 10000);
  if (unit === "k") return Math.round(n * 1000);
  return Math.round(n);
}

/** 从单条热榜条目中提取字段（兼容多种响应格式） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractItem(item: any, idx: number): ZhihuHotItem | null {
  // 格式一：嵌套 target 对象（Open API 常见格式）
  const target = item?.target ?? item;
  const title: string = target?.title ?? item?.question?.title ?? "";
  if (!title) return null;
  return {
    id:      String(target?.id ?? item?.id ?? idx),
    title,
    excerpt: String(target?.excerpt ?? item?.detail_text ?? item?.excerpt ?? ""),
    heat:    parseHeat(item?.detail_text ?? item?.hot_score ?? item?.heat ?? 0),
  };
}

export async function fetchHotList(
  accessToken?: string
): Promise<ZhihuHotItem[]> {
  // 优先用传入 token，其次用环境变量，都没有则走 mock
  const token = accessToken || process.env.ZHIHU_ACCESS_TOKEN || "";
  if (!token && !APP_ID) return MOCK_HOT_LIST;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token   ? { Authorization: `Bearer ${token}` } : {}),
    ...(APP_ID  ? { "X-APP-ID": APP_ID }               : {}),
  };

  // 依次尝试已知端点，第一个成功的为准
  const endpoints = [
    `${ZHIHU_BASE}/hot/list?limit=20`,
    `${ZHIHU_BASE}/topstory/hot-lists/total?limit=20&desktop=true`,
    `${ZHIHU_BASE}/v4/top-stories?limit=20`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers, next: { revalidate: 300 } });
      if (!res.ok) continue;

      const data = await res.json();
      const rawItems: unknown[] =
        Array.isArray(data)       ? data :
        Array.isArray(data?.data) ? data.data :
        Array.isArray(data?.list) ? data.list : [];

      if (rawItems.length === 0) continue;

      const items = rawItems
        .slice(0, 20)
        .map((item, i) => extractItem(item, i))
        .filter((x): x is ZhihuHotItem => x !== null);

      if (items.length > 0) return items;
    } catch { /* 尝试下一个端点 */ }
  }

  return MOCK_HOT_LIST;
}

// ─── 搜索 ──────────────────────────────────────────────────

export async function searchZhihu(
  query: string,
  accessToken?: string
): Promise<ZhihuHotItem[]> {
  const token = accessToken || process.env.ZHIHU_ACCESS_TOKEN || "";
  if (!token && !APP_ID) return MOCK_HOT_LIST.slice(0, 5);

  try {
    const params = new URLSearchParams({ q: query, limit: "10" });
    const res = await fetch(`${ZHIHU_BASE}/search?${params}`, {
      headers: {
        ...(token  ? { Authorization: `Bearer ${token}` } : {}),
        ...(APP_ID ? { "X-APP-ID": APP_ID }               : {}),
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rawItems = data?.data ?? [];
    return rawItems.map((item: unknown, i: number) => extractItem(item, i)).filter(Boolean);
  } catch {
    return [];
  }
}

// ─── 发布想法 ──────────────────────────────────────────────

export interface PublishIdeaParams {
  content: string;
  accessToken: string;
}

export async function publishIdea(
  params: PublishIdeaParams
): Promise<{ id: string; url: string }> {
  if (!APP_ID) {
    return { id: "mock-" + Date.now(), url: "https://www.zhihu.com/pin/mock" };
  }

  const res = await fetch(`${ZHIHU_BASE}/pins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      "X-APP-ID": APP_ID,
    },
    body: JSON.stringify({
      content: [{ type: "text", content: params.content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`发布失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { id: data.id, url: `https://www.zhihu.com/pin/${data.id}` };
}

// ─── 用户信息 ──────────────────────────────────────────────

export interface ZhihuUser {
  name: string;
  avatar: string;
}

export async function fetchUserProfile(token: string): Promise<ZhihuUser> {
  const res = await fetch(`${ZHIHU_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(APP_ID ? { "X-APP-ID": APP_ID } : {}),
    },
  });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  const data = await res.json();
  return {
    name: data.name || data.display_name || "知乎用户",
    avatar: data.avatar_url || data.avatar || "",
  };
}

// ─── Mock 数据（API 不可用时的降级） ─────────────────────────

const MOCK_HOT_LIST: ZhihuHotItem[] = [
  { id: "1", title: "DeepSeek 出新模型，普通人现在还该学 AI 吗？",    excerpt: "AI 学习路径讨论",   heat: 9800 },
  { id: "2", title: "35 岁被裁员，该如何重新出发？",                  excerpt: "职场中年困境话题",   heat: 8600 },
  { id: "3", title: "为什么年轻人越来越不想谈恋爱了？",                excerpt: "情感社会话题",       heat: 9200 },
  { id: "4", title: "苹果 M4 芯片性能到底强在哪里？",                  excerpt: "科技硬件分析",       heat: 7400 },
  { id: "5", title: "那些年我打过的工，现在回头看都是故事",             excerpt: "职场回忆叙事",       heat: 6800 },
  { id: "6", title: "AI Agent 真能替代初级产品经理吗？",               excerpt: "AI 职业影响分析",    heat: 8900 },
  { id: "7", title: "国产大模型追上之后，应用层机会在哪里？",           excerpt: "AI 创业赛道讨论",    heat: 9100 },
  { id: "8", title: "工作三年后，什么能力最容易拉开差距？",             excerpt: "职场成长方法论",     heat: 8800 },
];
