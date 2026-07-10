document.addEventListener("DOMContentLoaded", () => {
  const keywordInput = document.getElementById("keywordInput");
  const keywordType = document.getElementById("keywordType");
  const addKeywordButton = document.getElementById("addKeywordButton");
  const keywordList = document.getElementById("keywordList");
  const currentPackageLabel = document.getElementById("currentPackageLabel");

  let currentPackageName = DEFAULT_PACKAGE || "kids";
  let currentKeywords = { include: [], exclude: [] };

  function safeStorageGet(keys, fallback = {}) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return Promise.resolve(fallback);
    }

    return new Promise(resolve => {
      try {
        chrome.storage.local.get(keys, result => resolve(result || fallback));
      } catch (error) {
        console.warn("Keyword popup storage read failed:", error);
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
        console.warn("Keyword popup storage write failed:", error);
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

  function renderPackageInfo() {
    if (!currentPackageLabel) {
      return;
    }

    const label = PACKAGE_CONFIG[currentPackageName]?.label || currentPackageName;
    currentPackageLabel.textContent = `현재 패키지: ${label}`;
  }

  function createKeywordRow(keyword, type) {
    const row = document.createElement("div");
    row.className = "keyword-row";

    const label = document.createElement("span");
    label.textContent = `${type === "include" ? "허용" : "차단"}: ${keyword}`;

    const actions = document.createElement("span");
    actions.className = "keyword-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.type = type;
    button.dataset.keyword = keyword;
    button.textContent = "삭제";

    actions.appendChild(button);
    row.append(label, actions);
    return row;
  }

  function renderKeywords() {
    if (!keywordList) {
      return;
    }

    keywordList.textContent = "";

    const rows = [
      ...(currentKeywords.include || []).map(keyword => createKeywordRow(keyword, "include")),
      ...(currentKeywords.exclude || []).map(keyword => createKeywordRow(keyword, "exclude"))
    ];

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "아직 등록된 키워드가 없습니다.";
      keywordList.appendChild(empty);
      return;
    }

    rows.forEach(row => keywordList.appendChild(row));
  }

  function loadKeywordState() {
    safeStorageGet(["selectedPackage", "customKeywords"]).then(result => {
      currentPackageName = result.selectedPackage || DEFAULT_PACKAGE || "kids";
      currentKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);
      renderPackageInfo();
      renderKeywords();
    });
  }

  function saveKeywords(nextKeywords) {
    return safeStorageGet(["customKeywords"]).then(result => {
      const nextStorageKeywords = buildStoredKeywordsMap(result.customKeywords, currentPackageName, nextKeywords);
      currentKeywords = nextKeywords;
      renderKeywords();
      return safeStorageSet({ customKeywords: nextStorageKeywords });
    });
  }

  addKeywordButton?.addEventListener("click", () => {
    const keyword = keywordInput?.value?.trim();
    const type = keywordType?.value || "include";

    if (!keyword) {
      return;
    }

    const nextKeywords = {
      include: [...(currentKeywords.include || [])],
      exclude: [...(currentKeywords.exclude || [])]
    };

    if (!nextKeywords[type].includes(keyword)) {
      nextKeywords[type].push(keyword);
    }

    saveKeywords(nextKeywords).then(() => {
      keywordInput.value = "";
      keywordInput.focus();
    });
  });

  keywordInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      addKeywordButton?.click();
    }
  });

  keywordList?.addEventListener("click", event => {
    const button = event.target.closest("button[data-keyword]");
    if (!button) {
      return;
    }

    const keyword = button.getAttribute("data-keyword");
    const type = button.getAttribute("data-type") || "include";
    const nextKeywords = {
      include: [...(currentKeywords.include || [])],
      exclude: [...(currentKeywords.exclude || [])]
    };

    nextKeywords[type] = (nextKeywords[type] || []).filter(item => item !== keyword);
    saveKeywords(nextKeywords);
  });

  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && (changes.customKeywords || changes.selectedPackage)) {
        loadKeywordState();
      }
    });
  }

  loadKeywordState();
});
