import { SOURCES } from "./sources.js";

const MIN_SAFE_COUNT = 3;
const DEFAULT_LIMIT = 0; // 0 = 不限制
const FETCH_TIMEOUT_MS = 10000;
const CONCURRENCY = 5;

// BestCF 部分列表会在首尾放展示/导航用地址，不作为候选收录。
const SENTINEL_IPS = new Set([
  "162.159.198.1",
  "162.159.197.1"
]);

const US_HINTS = [
  /\bUS\b/i, /美国/, /\bLAX\b/i, /\bSJC\b/i, /\bSFO\b/i,
  /\bSEA\b/i, /\bPDX\b/i, /\bDFW\b/i, /\bORD\b/i,
  /\bIAD\b/i, /\bEWR\b/i, /\bMIA\b/i, /\bATL\b/i
];

const SG_HINTS = [
  /\bSG\b/i, /新加坡/, /印加坡/, /\bSIN\b/i
];

function isValidIPv4(ip) {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function detectCountry(text, forcedCountry) {
  if (forcedCountry === "US" || forcedCountry === "SG") {
    return forcedCountry;
  }

  const us = US_HINTS.some((r) => r.test(text));
  const sg = SG_HINTS.some((r) => r.test(text));

  // 同一小段同时出现两个地区时不猜，避免误分。
  if (us === sg) return null;
  return us ? "US" : "SG";
}

function extractCandidates(text, source) {
  const results = [];

  // 找到所有 IPv4[:port] 的位置，再用“当前 IP 到下一个 IP”作为备注上下文。
  const re = /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?/g;
  const matches = [...text.matchAll(re)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const ip = m[1];
    const port = Number(m[2] || 443);

    if (!isValidIPv4(ip)) continue;
    if (port < 1 || port > 65535) continue;
    if (SENTINEL_IPS.has(ip)) continue;

    const start = m.index ?? 0;
    const end = i + 1 < matches.length
      ? (matches[i + 1].index ?? text.length)
      : Math.min(text.length, start + 240);

    const segment = text.slice(start, end);

    if (/分享免费优选网|BestCF\.pages\.dev\s*$/i.test(segment)) {
      continue;
    }

    const country = detectCountry(segment, source.country);
    if (!country) continue;

    results.push({
      ip,
      port,
      country,
      source: source.name,
      priority: source.priority
    });
  }

  return results;
}

async function fetchText(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "cf-us-sg-aggregator/1.0",
        "Accept": "text/plain,*/*;q=0.8"
      },
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();

    // 防止异常页面/超大页面把 Worker 拖死。
    if (text.length > 2_000_000) {
      throw new Error("source too large");
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function mapInChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
  }
  return out;
}

function dedupeAndSort(items) {
  const sorted = [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.ip !== b.ip) return a.ip.localeCompare(b.ip, undefined, { numeric: true });
    return a.port - b.port;
  });

  const seen = new Set();
  const output = [];

  for (const item of sorted) {
    // 同一国家下 IP:port 去重。
    const key = `${item.country}|${item.ip}:${item.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function toTxt(items) {
  return items
    .map((x) => `${x.ip}:${x.port}#${x.country} | ${x.source}`)
    .join("\n") + (items.length ? "\n" : "");
}

async function refresh(env) {
  const startedAt = new Date().toISOString();

  const orderedSources = [...SOURCES].sort((a, b) => b.priority - a.priority);

  const fetched = await mapInChunks(
    orderedSources,
    CONCURRENCY,
    async (source) => {
      const t0 = Date.now();
      try {
        const text = await fetchText(source);
        const candidates = extractCandidates(text, source);
        return {
          ok: true,
          source,
          candidates,
          ms: Date.now() - t0
        };
      } catch (error) {
        return {
          ok: false,
          source,
          candidates: [],
          ms: Date.now() - t0,
          error: String(error?.message || error)
        };
      }
    }
  );

  const allCandidates = dedupeAndSort(
    fetched.flatMap((x) => x.candidates)
  );

  const newUS = allCandidates.filter((x) => x.country === "US");
  const newSG = allCandidates.filter((x) => x.country === "SG");

  // 安全策略：某次上游全部抽风时，不覆盖上一版可用结果。
  const oldUS = (await env.CFIP_KV.get("us.txt")) || "";
  const oldSG = (await env.CFIP_KV.get("sg.txt")) || "";

  const usText = newUS.length >= MIN_SAFE_COUNT ? toTxt(newUS) : oldUS;
  const sgText = newSG.length >= MIN_SAFE_COUNT ? toTxt(newSG) : oldSG;

  if (newUS.length >= MIN_SAFE_COUNT) {
    await env.CFIP_KV.put("us.txt", usText);
  }
  if (newSG.length >= MIN_SAFE_COUNT) {
    await env.CFIP_KV.put("sg.txt", sgText);
  }

  const allText = [usText.trim(), sgText.trim()]
    .filter(Boolean)
    .join("\n") + ((usText || sgText) ? "\n" : "");

  if (allText.trim()) {
    await env.CFIP_KV.put("all.txt", allText);
  }

  const status = {
    ok: Boolean(usText.trim() || sgText.trim()),
    startedAt,
    finishedAt: new Date().toISOString(),
    freshCounts: {
      US: newUS.length,
      SG: newSG.length
    },
    publishedFresh: {
      US: newUS.length >= MIN_SAFE_COUNT,
      SG: newSG.length >= MIN_SAFE_COUNT
    },
    sources: fetched.map((x) => ({
      name: x.source.name,
      url: x.source.url,
      country: x.source.country,
      ok: x.ok,
      count: x.candidates.length,
      ms: x.ms,
      error: x.error || null
    }))
  };

  await env.CFIP_KV.put("status.json", JSON.stringify(status, null, 2));
  return status;
}

function textResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
      ...extraHeaders
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function applyQueryFilters(text, url) {
  let lines = text.split(/\r?\n/).filter(Boolean);

  const port = url.searchParams.get("port");
  if (port && /^\d{1,5}$/.test(port)) {
    lines = lines.filter((line) => line.includes(`:${port}#`));
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  if (Number.isFinite(limit) && limit > 0) {
    lines = lines.slice(0, Math.min(limit, 500));
  }

  return lines.join("\n") + (lines.length ? "\n" : "");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    if (path === "/") {
      return textResponse(
`CF US/SG Auto Aggregator

GET  /us.txt
GET  /sg.txt
GET  /all.txt
GET  /status.json
GET  /sources.json

可选参数：
  ?limit=20
  ?port=443

示例：
  /us.txt?limit=20
  /sg.txt?limit=30&port=443

首次部署后：
  等待 Cron 自动运行，或配置 ADMIN_TOKEN 后 POST /refresh
`
      );
    }

    if (path === "/sources.json") {
      return jsonResponse(SOURCES);
    }

    if (path === "/status.json") {
      const raw = await env.CFIP_KV.get("status.json");
      if (!raw) return jsonResponse({ ok: false, message: "尚未执行首次聚合" }, 503);
      return new Response(raw, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*"
        }
      });
    }

    if (path === "/us.txt" || path === "/sg.txt" || path === "/all.txt") {
      const key = path.slice(1);
      const raw = await env.CFIP_KV.get(key);
      if (!raw) {
        return textResponse("尚未生成数据，请等待下一次 Cron 或手动刷新。\n", 503);
      }
      return textResponse(applyQueryFilters(raw, url));
    }

    if (path === "/refresh" && request.method === "POST") {
      if (!env.ADMIN_TOKEN) {
        return jsonResponse({
          ok: false,
          message: "未配置 ADMIN_TOKEN，手动刷新接口已禁用"
        }, 403);
      }

      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) {
        return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
      }

      const status = await refresh(env);
      return jsonResponse(status);
    }

    return textResponse("Not Found\n", 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env));
  }
};
