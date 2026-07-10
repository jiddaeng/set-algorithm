const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, "data");
const STORE_FILE = path.join(DATA_DIR, "policies.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function now() {
  return new Date().toISOString();
}

function createDefaultPolicy(deviceId) {
  return {
    deviceId,
    selectedPackage: "kids",
    filterMode: "blocklist",
    customKeywords: {
      kids: {
        include: [],
        exclude: ["adult", "violence", "horror", "fight", "gambling", "선정", "폭력", "공포", "자극", "성인"]
      }
    },
    stats: null,
    createdAt: now(),
    updatedAt: now()
  };
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadStore() {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { devices: {} };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { devices: {} };
    }
    throw error;
  }
}

async function saveStore(store) {
  await ensureDataDir();
  await fs.writeFile(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function corsHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, corsHeaders());
  response.end(JSON.stringify(payload));
}

function sendEmpty(response, statusCode = 204) {
  response.writeHead(statusCode, corsHeaders());
  response.end();
}

function notFound(response) {
  sendJson(response, 404, { error: "Not found" });
}

function badRequest(response, message) {
  sendJson(response, 400, { error: message });
}

function sanitizeId(value) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(text)) {
    return "";
  }
  return text;
}

function sanitizeKeywordsMap(rawKeywords) {
  if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
    return {};
  }

  const next = {};
  Object.entries(rawKeywords).forEach(([packageName, value]) => {
    if (!sanitizeId(packageName) || !value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    next[packageName] = {
      include: Array.isArray(value.include) ? value.include.map(String).map(item => item.trim()).filter(Boolean) : [],
      exclude: Array.isArray(value.exclude) ? value.exclude.map(String).map(item => item.trim()).filter(Boolean) : []
    };
  });

  return next;
}

function sanitizePolicyPatch(payload, currentPolicy) {
  const selectedPackage = sanitizeId(payload.selectedPackage) || currentPolicy.selectedPackage || "kids";
  const filterMode = ["purpose", "blocklist", "allowlist"].includes(payload.filterMode)
    ? payload.filterMode
    : currentPolicy.filterMode || "blocklist";

  return {
    ...currentPolicy,
    selectedPackage,
    filterMode,
    customKeywords: sanitizeKeywordsMap(payload.customKeywords),
    updatedAt: now()
  };
}

function getDevicePolicy(store, deviceId) {
  if (!store.devices[deviceId]) {
    store.devices[deviceId] = createDefaultPolicy(deviceId);
  }

  return store.devices[deviceId];
}

async function readRequestJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function serveStatic(requestUrl, response) {
  const pathname = ["/", "/parent", "/parent.html"].includes(requestUrl.pathname)
    ? "/index.html"
    : requestUrl.pathname;
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!requestedPath.startsWith(PUBLIC_DIR)) {
    notFound(response);
    return;
  }

  try {
    const content = await fs.readFile(requestedPath);
    const extension = path.extname(requestedPath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      notFound(response);
      return;
    }
    sendJson(response, 500, { error: error.message });
  }
}

function routeDevicePath(pathname) {
  const match = pathname.match(/^\/api\/devices\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }

  return {
    deviceId: sanitizeId(decodeURIComponent(match[1])),
    action: match[2] || ""
  };
}

async function handleApi(request, response, requestUrl) {
  if (request.method === "OPTIONS") {
    sendEmpty(response);
    return;
  }

  if (requestUrl.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, time: now() });
    return;
  }

  if (requestUrl.pathname === "/api/devices" && request.method === "GET") {
    const store = await loadStore();
    const devices = Object.values(store.devices || {}).map(policy => ({
      deviceId: policy.deviceId,
      selectedPackage: policy.selectedPackage,
      filterMode: policy.filterMode,
      updatedAt: policy.updatedAt,
      lastSeenAt: policy.lastSeenAt || null,
      stats: policy.stats || null
    }));
    sendJson(response, 200, { devices });
    return;
  }

  const deviceRoute = routeDevicePath(requestUrl.pathname);
  if (!deviceRoute || !deviceRoute.deviceId) {
    notFound(response);
    return;
  }

  const store = await loadStore();
  const policy = getDevicePolicy(store, deviceRoute.deviceId);

  if (deviceRoute.action === "register" && request.method === "POST") {
    const payload = await readRequestJson(request);
    store.devices[deviceRoute.deviceId] = {
      ...policy,
      extensionVersion: payload.extensionVersion || policy.extensionVersion || "",
      userAgent: payload.userAgent || policy.userAgent || "",
      lastSeenAt: now()
    };
    await saveStore(store);
    sendJson(response, 200, { ok: true, policy: store.devices[deviceRoute.deviceId] });
    return;
  }

  if (deviceRoute.action === "policy" && request.method === "GET") {
    policy.lastSeenAt = now();
    await saveStore(store);
    sendJson(response, 200, policy);
    return;
  }

  if (deviceRoute.action === "policy" && request.method === "PUT") {
    const payload = await readRequestJson(request);
    store.devices[deviceRoute.deviceId] = sanitizePolicyPatch(payload, policy);
    await saveStore(store);
    sendJson(response, 200, store.devices[deviceRoute.deviceId]);
    return;
  }

  if (deviceRoute.action === "stats" && request.method === "POST") {
    const payload = await readRequestJson(request);
    store.devices[deviceRoute.deviceId] = {
      ...policy,
      stats: {
        total: Number(payload.total || 0),
        kept: Number(payload.kept || 0),
        removed: Number(payload.removed || 0),
        packageName: payload.packageName || "",
        filterMode: payload.filterMode || "",
        updatedAt: payload.updatedAt || now(),
        uploadedAt: payload.uploadedAt || now()
      },
      lastSeenAt: now()
    };
    await saveStore(store);
    sendJson(response, 200, { ok: true });
    return;
  }

  badRequest(response, "Unsupported API route");
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi(request, response, requestUrl);
        return;
      }

      await serveStatic(requestUrl, response);
    } catch (error) {
      if (error instanceof SyntaxError) {
        badRequest(response, "Invalid JSON body");
        return;
      }
      sendJson(response, 500, { error: error.message });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Set Algorithm remote server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer,
  createDefaultPolicy
};
