document.addEventListener("DOMContentLoaded", () => {
  const keywordInput = document.getElementById("keywordInput");
  const keywordType = document.getElementById("keywordType");
  const addKeywordButton = document.getElementById("addKeywordButton");
  const keywordList = document.getElementById("keywordList");
  const currentPackageLabel = document.getElementById("currentPackageLabel");

  let currentPackageName = "study";
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

    currentPackageLabel.innerHTML = `현재 패키지: <strong>${currentPackageName}</strong>`;
  }

  function renderKeywords() {
    if (!keywordList) {
      return;
    }

    const includeItems = (currentKeywords.include || []).map(keyword => `
      <div class="keyword-row">
        <span>✅ ${keyword}</span>
        <span class="keyword-actions">
          <button data-type="include" data-keyword="${keyword}">삭제</button>
        </span>
      </div>
    `).join("");

    const excludeItems = (currentKeywords.exclude || []).map(keyword => `
      <div class="keyword-row">
        <span>🚫 ${keyword}</span>
        <span class="keyword-actions">
          <button data-type="exclude" data-keyword="${keyword}">삭제</button>
        </span>
      </div>
    `).join("");

    keywordList.innerHTML = `${includeItems}${excludeItems || "<div class=\"small\">아직 등록된 키워드가 없습니다.</div>"}`;
  }

  function loadKeywordState() {
    safeStorageGet(["selectedPackage", "customKeywords"]).then(result => {
      currentPackageName = result.selectedPackage || "study";
      currentKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);
      renderPackageInfo();
      renderKeywords();
    });
  }

  addKeywordButton?.addEventListener("click", () => {
    const keyword = keywordInput?.value?.trim();
    const type = keywordType?.value || "include";

    if (!keyword) {
      return;
    }

    safeStorageGet(["customKeywords"]).then(result => {
      const storedKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);
      const nextKeywords = {
        include: [...(storedKeywords.include || [])],
        exclude: [...(storedKeywords.exclude || [])]
      };

      const targetList = nextKeywords[type] || [];
      if (!targetList.includes(keyword)) {
        targetList.push(keyword);
      }
      nextKeywords[type] = targetList;

      currentKeywords = nextKeywords;
      renderKeywords();

      const nextStorageKeywords = buildStoredKeywordsMap(result.customKeywords, currentPackageName, nextKeywords);
      safeStorageSet({ customKeywords: nextStorageKeywords }).then(() => {
        keywordInput.value = "";
      });
    });
  });

  keywordList?.addEventListener("click", event => {
    const button = event.target.closest("button[data-keyword]");
    if (!button) {
      return;
    }

    const keyword = button.getAttribute("data-keyword");
    const type = button.getAttribute("data-type") || "include";

    safeStorageGet(["customKeywords"]).then(result => {
      const storedKeywords = normalizeKeywordsForPackage(result.customKeywords, currentPackageName);
      const nextKeywords = {
        include: [...(storedKeywords.include || [])],
        exclude: [...(storedKeywords.exclude || [])]
      };

      nextKeywords[type] = (nextKeywords[type] || []).filter(item => item !== keyword);
      currentKeywords = nextKeywords;
      renderKeywords();

      const nextStorageKeywords = buildStoredKeywordsMap(result.customKeywords, currentPackageName, nextKeywords);
      safeStorageSet({ customKeywords: nextStorageKeywords });
    });
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.customKeywords || changes.selectedPackage)) {
      loadKeywordState();
    }
  });

  loadKeywordState();
});
