document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("packageSelect");
  const packageSummary = document.getElementById("packageSummary");
  const filterStats = document.getElementById("filterStats");
  const manageKeywordsButton = document.getElementById("manageKeywordsButton");
  const remoteSyncEnabled = document.getElementById("remoteSyncEnabled");
  const remoteServerUrl = document.getElementById("remoteServerUrl");
  const remoteDeviceId = document.getElementById("remoteDeviceId");
  const remoteSyncStatus = document.getElementById("remoteSyncStatus");
  const saveRemoteSettingsButton = document.getElementById("saveRemoteSettingsButton");
  const syncRemoteNowButton = document.getElementById("syncRemoteNowButton");

  let currentPackageName = DEFAULT_PACKAGE || "kids";
  let currentCustomKeywords = { include: [], exclude: [] };

  function safeStorageGet(keys, fallback = {}) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return Promise.resolve(fallback);
    }

    return new Promise(resolve => {
      try {
        chrome.storage.local.get(keys, result => resolve(result || fallback));
      } catch (error) {
        console.warn("Popup storage read failed:", error);
        resolve(fallback);
      }
    });
  }

  function safeStorageSet(data) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      try {
        chrome.storage.local.set(data, () => resolve());
      } catch (error) {
        console.warn("Popup storage write failed:", error);
        resolve();
      }
    });
  }

  function normalizeKeywordsForPackage(rawKeywords, packageName = currentPackageName) {
    if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
      return { include: [], exclude: [] };
    }

    if (rawKeywords.include || rawKeywords.exclude) {
      return {
        include: [...(rawKeywords.include || [])],
        exclude: [...(rawKeywords.exclude || [])]
      };
    }

    const entry = rawKeywords[packageName] || rawKeywords[packageName?.toLowerCase()] || {};
    return {
      include: [...(entry.include || [])],
      exclude: [...(entry.exclude || [])]
    };
  }

  function getCustomPackageEntries(rawKeywords) {
    if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
      return [];
    }

    const builtInNames = new Set(PACKAGE_NAMES || Object.keys(PACKAGE_CONFIG));
    return Object.keys(rawKeywords)
      .filter(packageName => !builtInNames.has(packageName))
      .map(packageName => ({
        key: packageName,
        label: `${packageName} Pack`
      }));
  }

  function refreshPackageSelect(rawKeywords = null) {
    if (!select) {
      return;
    }

    const customPackages = getCustomPackageEntries(rawKeywords);
    select.innerHTML = "";

    [
      ...Object.entries(PACKAGE_CONFIG).map(([value, config]) => ({
        value,
        label: config.label || value
      })),
      ...customPackages.map(pkg => ({ value: pkg.key, label: pkg.label }))
    ].forEach(optionData => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.appendChild(option);
    });

    if (currentPackageName && [...select.options].some(option => option.value === currentPackageName)) {
      select.value = currentPackageName;
    } else if (select.options.length) {
      select.value = select.options[0].value;
    }
  }

  function notifyActiveTabRefresh() {
    if (typeof chrome === "undefined" || !chrome.tabs?.query || !chrome.tabs?.sendMessage) {
      return;
    }

    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs?.[0];
        if (!tab?.id) {
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: "SET_ALGORITHM_REFRESH" });
      });
    } catch (error) {
      console.warn("Popup refresh message failed:", error);
    }
  }

  function renderPackageInfo(packageName = currentPackageName, customKeywords = currentCustomKeywords, filterMode = "purpose") {
    const baseConfig = PACKAGE_CONFIG[packageName] || { include: [], exclude: [] };
    const resolvedKeywords = customKeywords || { include: [], exclude: [] };
    const config = {
      include: [...(baseConfig.include || []), ...(resolvedKeywords.include || [])],
      exclude: [...(baseConfig.exclude || []), ...(resolvedKeywords.exclude || [])]
    };

    if (!packageSummary) {
      return;
    }

    packageSummary.textContent = "";

    const modeRow = document.createElement("div");
    modeRow.textContent = `모드: ${filterMode}`;

    const includeRow = document.createElement("div");
    includeRow.textContent = `적합 키워드: ${config.include.join(", ") || "없음"}`;

    const excludeRow = document.createElement("div");
    excludeRow.className = "small";
    excludeRow.textContent = `부적합 키워드: ${config.exclude.join(", ") || "없음"}`;

    packageSummary.append(modeRow, includeRow, excludeRow);
  }

  function renderStats(statsData = null) {
    const stats = statsData || { total: 0, kept: 0, removed: 0 };
    if (!filterStats) {
      return;
    }

    filterStats.textContent = "";
    ["분석 대상", "유지", "숨김"].forEach((label, index) => {
      const values = [stats.total || 0, stats.kept || 0, stats.removed || 0];
      const row = document.createElement("div");
      row.textContent = `${label}: ${values[index]}`;
      filterStats.appendChild(row);
    });
  }

  function renderRemoteInfo(settings = {}, status = null) {
    if (remoteSyncEnabled) {
      remoteSyncEnabled.checked = settings.enabled !== false;
    }

    if (remoteServerUrl) {
      remoteServerUrl.value = settings.serverUrl || "http://localhost:3000";
    }

    if (remoteDeviceId) {
      remoteDeviceId.textContent = settings.deviceId || "-";
    }

    if (!remoteSyncStatus) {
      return;
    }

    if (!status) {
      remoteSyncStatus.textContent = "아직 동기화 기록이 없습니다.";
      return;
    }

    if (status.ok) {
      remoteSyncStatus.textContent = `마지막 동기화: ${status.lastSyncAt || "-"} (${status.reason || "sync"})`;
      return;
    }

    remoteSyncStatus.textContent = `동기화 실패: ${status.error || "알 수 없는 오류"}`;
  }

  function loadPopupState() {
    safeStorageGet(["selectedPackage", "customKeywords", "filterStats", "filterMode", "remoteSettings", "remoteSyncStatus"]).then(result => {
      currentPackageName = result.selectedPackage || DEFAULT_PACKAGE || "kids";
      currentCustomKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);

      refreshPackageSelect(result.customKeywords);
      renderPackageInfo(currentPackageName, currentCustomKeywords, result.filterMode || "purpose");
      renderStats(result.filterStats || { total: 0, kept: 0, removed: 0 });
      renderRemoteInfo(result.remoteSettings || {}, result.remoteSyncStatus || null);
    });
  }

  function applySelectedPackage(packageName) {
    const nextPackageName = packageName || currentPackageName || DEFAULT_PACKAGE || "kids";
    currentPackageName = nextPackageName;

    return safeStorageSet({ selectedPackage: nextPackageName }).then(() => {
      loadPopupState();
      notifyActiveTabRefresh();
    });
  }

  function sendRuntimeMessage(message) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return Promise.resolve({ ok: false, error: "chrome.runtime is unavailable" });
    }

    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  select?.addEventListener("change", () => {
    applySelectedPackage(select.value);
  });

  manageKeywordsButton?.addEventListener("click", () => {
    const packageName = select?.value || currentPackageName || DEFAULT_PACKAGE || "kids";

    applySelectedPackage(packageName).then(() => {
      if (typeof chrome === "undefined" || !chrome.windows?.create || !chrome.runtime?.getURL) {
        return;
      }

      chrome.windows.create({
        url: chrome.runtime.getURL("keyword-popup.html"),
        type: "popup",
        width: 420,
        height: 560
      });
    });
  });

  saveRemoteSettingsButton?.addEventListener("click", () => {
    sendRuntimeMessage({
      type: "SET_ALGORITHM_REMOTE_SETTINGS",
      settings: {
        enabled: Boolean(remoteSyncEnabled?.checked),
        serverUrl: remoteServerUrl?.value || "http://localhost:3000"
      }
    }).then(loadPopupState);
  });

  syncRemoteNowButton?.addEventListener("click", () => {
    sendRuntimeMessage({ type: "SET_ALGORITHM_REMOTE_SYNC_NOW" }).then(loadPopupState);
  });

  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && (
        changes.customKeywords ||
        changes.selectedPackage ||
        changes.filterStats ||
        changes.filterMode ||
        changes.remoteSettings ||
        changes.remoteSyncStatus
      )) {
        loadPopupState();
      }
    });
  }

  loadPopupState();
});
