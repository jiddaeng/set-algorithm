document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("packageSelect");
  const button = document.getElementById("saveButton");
  const packageSummary = document.getElementById("packageSummary");
  const filterStats = document.getElementById("filterStats");
  const manageKeywordsButton = document.getElementById("manageKeywordsButton");

  let currentPackageName = "study";
  let currentCustomKeywords = { include: [], exclude: [] };


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

  function buildStoredKeywordsMap(rawKeywords, packageName, packageKeywords) {
    if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
      return {
        [packageName]: packageKeywords
      };
    }

    if (rawKeywords.include || rawKeywords.exclude) {
      return {
        [packageName]: packageKeywords
      };
    }

    const nextMap = {};
    Object.entries(rawKeywords).forEach(([key, value]) => {
      if (value && typeof value === "object") {
        nextMap[key] = {
          include: [...(value.include || [])],
          exclude: [...(value.exclude || [])]
        };
      }
    });

    nextMap[packageName] = packageKeywords;
    return nextMap;
  }

  function refreshPackageSelect(rawKeywords = null) {
    if (!select) {
      return;
    }

    const customPackages = getCustomPackageEntries(rawKeywords);
    const optionValues = new Set(["study", "workout", "development", "reading"]);

    customPackages.forEach(pkg => optionValues.add(pkg.key));

    select.innerHTML = "";

    [
      { value: "study", label: "Study Pack" },
      { value: "workout", label: "Workout Pack" },
      { value: "development", label: "Development Pack" },
      { value: "reading", label: "Reading Pack" },
      ...customPackages.map(pkg => ({ value: pkg.key, label: pkg.label }))
    ].forEach(optionData => {
      if (!optionValues.has(optionData.value)) {
        return;
      }

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

  function renderPackageInfo(packageName = currentPackageName, customKeywords = currentCustomKeywords) {
    const baseConfig = PACKAGE_CONFIG[packageName] || PACKAGE_CONFIG.study;
    const resolvedKeywords = customKeywords || { include: [], exclude: [] };
    const config = {
      include: [...(baseConfig.include || []), ...(resolvedKeywords.include || [])],
      exclude: [...(baseConfig.exclude || []), ...(resolvedKeywords.exclude || [])]
    };

    const includeText = (config.include || []).join(", ");
    const excludeText = (config.exclude || []).join(", ");

    if (packageSummary) {
      packageSummary.innerHTML = `
        <div><strong>적합 키워드</strong>: ${includeText || "없음"}</div>
        <div class="small"><strong>부적합 키워드</strong>: ${excludeText || "없음"}</div>
      `;
    }
  }

  function renderStats(statsData = null) {
    const stats = statsData || { total: 0, kept: 0, removed: 0 };
    if (filterStats) {
      filterStats.innerHTML = `
        <div><strong>분석된 영상 수</strong>: ${stats.total || 0}</div>
        <div><strong>남은 영상 수</strong>: ${stats.kept || 0}</div>
        <div><strong>제거된 영상 수</strong>: ${stats.removed || 0}</div>
      `;
    }
  }

  function loadPopupState() {
    safeStorageGet(["selectedPackage", "customKeywords", "filterStats"]).then(result => {
      currentPackageName = result.selectedPackage || "study";
      currentCustomKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);

      if (select) {
        select.value = currentPackageName;
      }

      renderPackageInfo(currentPackageName, currentCustomKeywords);
      renderStats(result.filterStats || { total: 0, kept: 0, removed: 0 });
    });
  }

  function applySelectedPackage(packageName) {
    const nextPackageName = packageName || currentPackageName || "study";
    currentPackageName = nextPackageName;

    return safeStorageSet({ selectedPackage: nextPackageName }).then(() => {
      loadPopupState();
      notifyActiveTabRefresh();
    });
  }

  loadPopupState();

  select?.addEventListener("change", () => {
    applySelectedPackage(select.value);
  });

  button?.addEventListener("click", () => {
    applySelectedPackage(select?.value || currentPackageName || "study");
  });

  manageKeywordsButton?.addEventListener("click", () => {
    const packageName = select?.value || currentPackageName || "study";

    applySelectedPackage(packageName).then(() => {
      chrome.windows?.create({
        url: chrome.runtime.getURL("keyword-popup.html"),
        type: "popup",
        width: 420,
        height: 560
      });
    });
  });


  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.customKeywords || changes.selectedPackage || changes.filterStats)) {
      loadPopupState();
    }
  });
});
