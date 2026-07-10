const serverStatus = document.getElementById("serverStatus");
const deviceIdInput = document.getElementById("deviceIdInput");
const loadDeviceButton = document.getElementById("loadDeviceButton");
const refreshDevicesButton = document.getElementById("refreshDevicesButton");
const deviceList = document.getElementById("deviceList");
const policyMeta = document.getElementById("policyMeta");
const statsBox = document.getElementById("statsBox");
const savePolicyButton = document.getElementById("savePolicyButton");
const packageSelect = document.getElementById("packageSelect");
const filterModeSelect = document.getElementById("filterModeSelect");
const includeKeywordInput = document.getElementById("includeKeywordInput");
const excludeKeywordInput = document.getElementById("excludeKeywordInput");
const addIncludeButton = document.getElementById("addIncludeButton");
const addExcludeButton = document.getElementById("addExcludeButton");
const includeKeywordList = document.getElementById("includeKeywordList");
const excludeKeywordList = document.getElementById("excludeKeywordList");

const DEFAULT_DEVICE_ID = "demo-child";
const PACKAGE_LABELS = {
  kids: "Kids Safe Pack",
  study: "Study Pack",
  workout: "Workout Pack",
  development: "Development Pack",
  reading: "Reading Pack"
};
const FILTER_MODE_LABELS = {
  blocklist: "차단 키워드만 숨기기",
  allowlist: "허용 키워드가 있는 영상만 보이기",
  purpose: "패키지 목적 점수로 판단"
};

let currentDeviceId = "";
let currentPolicy = null;
let waitingForChildRevision = null;
let currentKeywords = {
  include: [],
  exclude: []
};

function getInitialDeviceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("device") || localStorage.getItem("setAlgorithmDeviceId") || DEFAULT_DEVICE_ID;
}

function setStatus(text, type = "") {
  serverStatus.textContent = text;
  serverStatus.className = `status ${type}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `요청 실패: ${response.status}`);
    error.status = response.status;
    error.policy = payload.policy || null;
    throw error;
  }

  return response.json();
}

function normalizeKeywordList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...new Set(items.map(item => String(item).trim()).filter(Boolean))];
}

function getPolicyKeywords(policy, packageName = policy?.selectedPackage || "kids") {
  const entry = policy?.customKeywords?.[packageName] || {};
  return {
    include: normalizeKeywordList(entry.include),
    exclude: normalizeKeywordList(entry.exclude)
  };
}

function setPolicyKeywords(policy, packageName, keywords) {
  return {
    ...policy,
    customKeywords: {
      ...(policy.customKeywords || {}),
      [packageName]: {
        include: normalizeKeywordList(keywords.include),
        exclude: normalizeKeywordList(keywords.exclude)
      }
    }
  };
}

function renderMeta(policy) {
  policyMeta.textContent = "";

  const rows = [
    ["기기 ID", policy.deviceId],
    ["패키지", PACKAGE_LABELS[policy.selectedPackage] || policy.selectedPackage],
    ["모드", FILTER_MODE_LABELS[policy.filterMode] || policy.filterMode],
    ["정책 버전", policy.revision || 1],
    ["마지막 정책 수정", policy.updatedAt || "-"],
    ["마지막 확장 접속", policy.lastSeenAt || "-"],
    ["자녀 동기화", policy.lastAppliedAt ? `${policy.lastAppliedAt} (v${policy.lastAppliedRevision || 1})` : "대기 중"]
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.textContent = `${label}: ${value || "-"}`;
    policyMeta.appendChild(row);
  });
}

function renderStats(stats) {
  statsBox.textContent = "";

  if (!stats) {
    statsBox.textContent = "아직 필터링 결과가 없습니다.";
    return;
  }

  [
    ["분석", stats.total || 0],
    ["표시", stats.kept || 0],
    ["숨김", stats.removed || 0]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "stat";

    const strong = document.createElement("strong");
    strong.textContent = value;

    const span = document.createElement("span");
    span.textContent = label;

    item.append(strong, span);
    statsBox.appendChild(item);
  });
}

function createChip(keyword, type) {
  const chip = document.createElement("span");
  chip.className = `chip ${type}`;

  const text = document.createElement("span");
  text.textContent = keyword;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.keyword = keyword;
  button.dataset.type = type;
  button.textContent = "x";
  button.title = `${keyword} 삭제`;

  chip.append(text, button);
  return chip;
}

function renderKeywordList(target, keywords, type) {
  target.textContent = "";

  if (!keywords.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = type === "include" ? "허용 키워드가 없습니다." : "차단 키워드가 없습니다.";
    target.appendChild(empty);
    return;
  }

  keywords.forEach(keyword => {
    target.appendChild(createChip(keyword, type));
  });
}

function renderPolicy(policy) {
  currentPolicy = policy;
  currentDeviceId = policy.deviceId;
  localStorage.setItem("setAlgorithmDeviceId", currentDeviceId);

  deviceIdInput.value = currentDeviceId;
  packageSelect.value = policy.selectedPackage || "kids";
  filterModeSelect.value = policy.filterMode || "blocklist";
  currentKeywords = getPolicyKeywords(policy, packageSelect.value);

  renderMeta(policy);
  renderStats(policy.stats || null);
  renderKeywordList(includeKeywordList, currentKeywords.include, "include");
  renderKeywordList(excludeKeywordList, currentKeywords.exclude, "exclude");
  highlightActiveDevice();

  if (waitingForChildRevision && Number(policy.lastAppliedRevision || 0) >= waitingForChildRevision) {
    waitingForChildRevision = null;
    setStatus("자녀 기기에 정책 동기화가 완료되었습니다.", "ok");
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForChildPolicyApplication(deviceId, revision) {
  for (let attempt = 0; attempt < 15 && waitingForChildRevision === revision; attempt += 1) {
    await delay(2000);
    const policy = await api(`/api/devices/${encodeURIComponent(deviceId)}/policy`);
    renderPolicy(policy);

    if (Number(policy.lastAppliedRevision || 0) >= revision) {
      return;
    }
  }

  if (waitingForChildRevision === revision) {
    waitingForChildRevision = null;
    setStatus("자녀 기기 동기화 확인을 기다리는 중입니다.", "error");
  }
}

async function loadDevice(deviceId) {
  const cleanDeviceId = String(deviceId || "").trim();
  if (!cleanDeviceId) {
    setStatus("기기 ID가 필요합니다.", "error");
    return;
  }

  setStatus("정책 불러오는 중");
  const policy = await api(`/api/devices/${encodeURIComponent(cleanDeviceId)}/policy`);
  renderPolicy(policy);
  setStatus("연결됨", "ok");
}

function highlightActiveDevice() {
  document.querySelectorAll(".device-button").forEach(button => {
    button.classList.toggle("active", button.dataset.deviceId === currentDeviceId);
  });
}

function renderDeviceList(devices) {
  deviceList.textContent = "";

  if (!devices.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "아직 등록된 기기가 없습니다.";
    deviceList.appendChild(empty);
    return;
  }

  devices.forEach(device => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "device-button";
    button.dataset.deviceId = device.deviceId;

    const name = document.createElement("span");
    name.textContent = device.deviceId;

    const meta = document.createElement("span");
    meta.textContent = device.lastSeenAt ? "synced" : "new";

    button.append(name, meta);
    button.addEventListener("click", () => loadDevice(device.deviceId).catch(showError));
    deviceList.appendChild(button);
  });

  highlightActiveDevice();
}

async function refreshDevices() {
  const result = await api("/api/devices");
  renderDeviceList(result.devices || []);
}

function addKeyword(type) {
  const input = type === "include" ? includeKeywordInput : excludeKeywordInput;
  const keyword = input.value.trim();

  if (!keyword) {
    return;
  }

  currentKeywords[type] = normalizeKeywordList([...(currentKeywords[type] || []), keyword]);
  input.value = "";
  input.focus();
  renderKeywordList(type === "include" ? includeKeywordList : excludeKeywordList, currentKeywords[type], type);
}

function removeKeyword(type, keyword) {
  currentKeywords[type] = (currentKeywords[type] || []).filter(item => item !== keyword);
  renderKeywordList(type === "include" ? includeKeywordList : excludeKeywordList, currentKeywords[type], type);
}

async function savePolicy() {
  if (!currentPolicy) {
    await loadDevice(deviceIdInput.value);
  }

  const packageName = packageSelect.value || "kids";
  const nextPolicy = setPolicyKeywords({
    ...currentPolicy,
    selectedPackage: packageName,
    filterMode: filterModeSelect.value || "blocklist",
    baseRevision: Number(currentPolicy.revision || 1)
  }, packageName, currentKeywords);

  try {
    setStatus("저장 중");
    const savedPolicy = await api(`/api/devices/${encodeURIComponent(currentDeviceId)}/policy`, {
      method: "PUT",
      body: JSON.stringify(nextPolicy)
    });
    renderPolicy(savedPolicy);
    await refreshDevices();
    waitingForChildRevision = Number(savedPolicy.revision || 1);
    setStatus("저장됨. 자녀 기기 동기화를 기다리는 중입니다.", "ok");
    waitForChildPolicyApplication(savedPolicy.deviceId, waitingForChildRevision).catch(showError);
  } catch (error) {
    if (error.status === 409 && error.policy) {
      renderPolicy(error.policy);
      await refreshDevices();
      setStatus("다른 부모 정책이 먼저 저장되어 최신 상태를 불러왔습니다.", "error");
      return;
    }
    throw error;
  }
}

function showError(error) {
  console.error(error);
  setStatus(error.message || "오류가 발생했습니다.", "error");
}

loadDeviceButton.addEventListener("click", () => {
  loadDevice(deviceIdInput.value).then(refreshDevices).catch(showError);
});

refreshDevicesButton.addEventListener("click", () => {
  refreshDevices().catch(showError);
});

savePolicyButton.addEventListener("click", () => {
  savePolicy().catch(showError);
});

packageSelect.addEventListener("change", () => {
  if (!currentPolicy) {
    return;
  }

  currentKeywords = getPolicyKeywords(currentPolicy, packageSelect.value);
  renderKeywordList(includeKeywordList, currentKeywords.include, "include");
  renderKeywordList(excludeKeywordList, currentKeywords.exclude, "exclude");
});

addIncludeButton.addEventListener("click", () => addKeyword("include"));
addExcludeButton.addEventListener("click", () => addKeyword("exclude"));

[includeKeywordInput, excludeKeywordInput].forEach((input, index) => {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      addKeyword(index === 0 ? "include" : "exclude");
    }
  });
});

[includeKeywordList, excludeKeywordList].forEach(list => {
  list.addEventListener("click", event => {
    const button = event.target.closest("button[data-keyword]");
    if (!button) {
      return;
    }

    removeKeyword(button.dataset.type, button.dataset.keyword);
  });
});

async function boot() {
  try {
    setStatus("서버 연결 중");
    await api("/api/health");
    setStatus("서버 정상", "ok");

    const deviceId = getInitialDeviceId();
    deviceIdInput.value = deviceId;
    await loadDevice(deviceId);
    await refreshDevices();
  } catch (error) {
    showError(error);
  }
}

boot();
setInterval(() => {
  if (!currentDeviceId) {
    return;
  }

  Promise.all([
    loadDevice(currentDeviceId),
    refreshDevices()
  ]).catch(showError);
}, 8000);
