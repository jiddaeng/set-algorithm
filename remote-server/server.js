const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const dataDirectory = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DATA_DIR = dataDirectory
  ? path.resolve(dataDirectory)
  : path.join(ROOT_DIR, "data");
const STORE_FILE = path.join(DATA_DIR, "policies.json");
const FAMILY_KEY = String(process.env.FAMILY_KEY || "").trim();
const DEVICE_KEY = String(process.env.DEVICE_KEY || "").trim();
const IS_RENDER = Boolean(process.env.RENDER);

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
    revision: 1,
    updatedBy: "parent",
    lastAppliedRevision: 0,
    lastAppliedAt: null,
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

function getPolicyRevision(policy) {
  const revision = Number(policy?.revision);
  return Number.isInteger(revision) && revision > 0 ? revision : 1;
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
    "Access-Control-Allow-Headers": "Content-Type, X-Family-Key, X-Device-Key"
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

function hasValidSecret(request, headerName, expectedSecret) {
  if (!expectedSecret) {
    return !IS_RENDER;
  }

  const suppliedKey = String(request.headers[headerName] || "");
  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedKey);

  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function requireSecret(request, response, options) {
  if (hasValidSecret(request, options.headerName, options.secret)) {
    return true;
  }

  if (!options.secret && IS_RENDER) {
    sendJson(response, 503, { error: `Server ${options.environmentName} is not configured.` });
    return false;
  }

  sendJson(response, 401, { error: options.errorMessage });
  return false;
}

function requireFamilyKey(request, response) {
  return requireSecret(request, response, {
    headerName: "x-family-key",
    secret: FAMILY_KEY,
    environmentName: "FAMILY_KEY",
    errorMessage: "가족 키가 올바르지 않습니다."
  });
}

function requireDeviceKey(request, response) {
  return requireSecret(request, response, {
    headerName: "x-device-key",
    secret: DEVICE_KEY,
    environmentName: "DEVICE_KEY",
    errorMessage: "기기 연결 키가 올바르지 않습니다."
  });
}

function requireFamilyOrDeviceKey(request, response) {
  if (
    hasValidSecret(request, "x-family-key", FAMILY_KEY) ||
    hasValidSecret(request, "x-device-key", DEVICE_KEY)
  ) {
    return true;
  }

  if (IS_RENDER && (!FAMILY_KEY || !DEVICE_KEY)) {
    sendJson(response, 503, { error: "Server FAMILY_KEY or DEVICE_KEY is not configured." });
    return false;
  }

  sendJson(response, 401, { error: "인증 키가 올바르지 않습니다." });
  return false;
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
    revision: getPolicyRevision(currentPolicy) + 1,
    updatedBy: "parent",
    selectedPackage,
    filterMode,
    customKeywords: sanitizeKeywordsMap(payload.customKeywords),
    updatedAt: now()
  };
}

function sanitizeCachedPolicy(payload, deviceId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const fallback = createDefaultPolicy(deviceId);
  const selectedPackage = sanitizeId(payload.selectedPackage) || fallback.selectedPackage;
  const filterMode = ["purpose", "blocklist", "allowlist"].includes(payload.filterMode)
    ? payload.filterMode
    : fallback.filterMode;

  return {
    ...fallback,
    revision: getPolicyRevision(payload),
    selectedPackage,
    filterMode,
    customKeywords: sanitizeKeywordsMap(payload.customKeywords),
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : fallback.createdAt,
    updatedAt: typeof payload.policyUpdatedAt === "string"
      ? payload.policyUpdatedAt
      : typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : fallback.updatedAt,
    recoveredAt: now()
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function getPolicySignaturePayload(policy, deviceId = policy?.deviceId) {
  return {
    deviceId: sanitizeId(deviceId),
    revision: getPolicyRevision(policy),
    selectedPackage: sanitizeId(policy?.selectedPackage) || "kids",
    filterMode: ["purpose", "blocklist", "allowlist"].includes(policy?.filterMode)
      ? policy.filterMode
      : "blocklist",
    customKeywords: sanitizeKeywordsMap(policy?.customKeywords),
    policyUpdatedAt: String(policy?.policyUpdatedAt || policy?.updatedAt || "")
  };
}

function createPolicySignature(policy, deviceId = policy?.deviceId) {
  if (!FAMILY_KEY) {
    return "";
  }

  return crypto
    .createHmac("sha256", FAMILY_KEY)
    .update(stableStringify(getPolicySignaturePayload(policy, deviceId)))
    .digest("hex");
}

function hasValidPolicySignature(policy, deviceId) {
  if (!FAMILY_KEY) {
    return !IS_RENDER;
  }

  const supplied = Buffer.from(String(policy?.policySignature || ""));
  const expected = Buffer.from(createPolicySignature(policy, deviceId));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function withPolicySignature(policy) {
  return {
    ...policy,
    policySignature: createPolicySignature(policy)
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
    sendJson(response, 200, {
      ok: true,
      time: now(),
      authenticationRequired: Boolean(FAMILY_KEY),
      deviceAuthenticationRequired: Boolean(DEVICE_KEY),
      configured: (Boolean(FAMILY_KEY) && Boolean(DEVICE_KEY)) || !IS_RENDER
    });
    return;
  }

  if (requestUrl.pathname === "/api/devices" && request.method === "GET") {
    if (!requireFamilyKey(request, response)) {
      return;
    }

    const store = await loadStore();
    const devices = Object.values(store.devices || {}).map(policy => ({
      deviceId: policy.deviceId,
      selectedPackage: policy.selectedPackage,
      filterMode: policy.filterMode,
      revision: getPolicyRevision(policy),
      updatedAt: policy.updatedAt,
      lastSeenAt: policy.lastSeenAt || null,
      lastAppliedRevision: Number(policy.lastAppliedRevision || 0),
      lastAppliedAt: policy.lastAppliedAt || null,
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

  if (["register", "ack", "stats"].includes(deviceRoute.action)) {
    if (!requireDeviceKey(request, response)) {
      return;
    }
  } else if (deviceRoute.action === "policy" && request.method === "GET") {
    if (!requireFamilyOrDeviceKey(request, response)) {
      return;
    }
  } else if (deviceRoute.action === "policy" && request.method === "PUT") {
    if (!requireFamilyKey(request, response)) {
      return;
    }
  } else {
    badRequest(response, "Unsupported API route");
    return;
  }

  const store = await loadStore();
  const policy = getDevicePolicy(store, deviceRoute.deviceId);

  if (deviceRoute.action === "register" && request.method === "POST") {
    const payload = await readRequestJson(request);
    const canRecoverCachedPolicy = !store.devices[deviceRoute.deviceId] || (
      !policy.lastSeenAt &&
      getPolicyRevision(policy) === 1
    );
    const recoveredPolicy = canRecoverCachedPolicy && hasValidPolicySignature(payload.cachedPolicy, deviceRoute.deviceId)
      ? sanitizeCachedPolicy(payload.cachedPolicy, deviceRoute.deviceId)
      : null;

    store.devices[deviceRoute.deviceId] = {
      ...(recoveredPolicy || policy),
      extensionVersion: payload.extensionVersion || policy.extensionVersion || "",
      userAgent: payload.userAgent || policy.userAgent || "",
      lastSeenAt: now()
    };
    await saveStore(store);
    sendJson(response, 200, {
      ok: true,
      policy: withPolicySignature(store.devices[deviceRoute.deviceId])
    });
    return;
  }

  if (deviceRoute.action === "policy" && request.method === "GET") {
    policy.lastSeenAt = now();
    await saveStore(store);
    sendJson(response, 200, withPolicySignature(policy));
    return;
  }

  if (deviceRoute.action === "policy" && request.method === "PUT") {
    const payload = await readRequestJson(request);
    const requestedRevision = Number(payload.baseRevision);
    const currentRevision = getPolicyRevision(policy);

    if (!Number.isInteger(requestedRevision) || requestedRevision !== currentRevision) {
      sendJson(response, 409, {
        error: "Policy changed by the parent dashboard. Reload before saving again.",
        policy: withPolicySignature({
          ...policy,
          revision: currentRevision
        })
      });
      return;
    }

    store.devices[deviceRoute.deviceId] = sanitizePolicyPatch(payload, policy);
    await saveStore(store);
    sendJson(response, 200, withPolicySignature(store.devices[deviceRoute.deviceId]));
    return;
  }

  if (deviceRoute.action === "ack" && request.method === "POST") {
    const payload = await readRequestJson(request);
    const acknowledgedRevision = Number(payload.revision);
    const currentRevision = getPolicyRevision(policy);

    if (!Number.isInteger(acknowledgedRevision) || acknowledgedRevision !== currentRevision) {
      sendJson(response, 409, {
        error: "Acknowledgement does not match the current policy.",
        revision: currentRevision
      });
      return;
    }

    store.devices[deviceRoute.deviceId] = {
      ...policy,
      lastAppliedRevision: acknowledgedRevision,
      lastAppliedAt: now(),
      lastSeenAt: now()
    };
    await saveStore(store);
    sendJson(response, 200, { ok: true, revision: acknowledgedRevision });
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
