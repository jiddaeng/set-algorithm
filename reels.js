let reelsProcessing = false;
let lastReelPackage = "";
let lastReelPath = "";
let reelsAlive = true;
let reelsTimer = null;
let pendingReelReprocess = false;
let lastSkipAt = 0;
let lastDecisionReelId = "";
let cachedReelConfig = null;
let cachedReelPackage = "";
let wakeupTimer = null;

const isInstagramHost = window.location.hostname.includes("instagram.com");
const SKIP_COOLDOWN_MS = 3000;
const REEL_POLL_MS = 4000;

function isContextInvalidatedError(error) {
    return String(error?.message || error || "").includes("Extension context invalidated");
}

function shutdownReels(reason = "") {
    reelsAlive = false;
    if (reelsTimer) {
        clearInterval(reelsTimer);
        reelsTimer = null;
    }
    if (wakeupTimer) {
        clearTimeout(wakeupTimer);
        wakeupTimer = null;
    }
    if (reason) {
        console.warn(`[Set Algorithm - Reels] stopped: ${reason}`);
    }
}

function isReelViewerPage() {
    return /^\/reels\/[^/]+\/?$/i.test(window.location.pathname) ||
        /^\/reel\/[^/]+\/?$/i.test(window.location.pathname);
}

function isReelsTabPage() {
    return /^\/reels\/?$/i.test(window.location.pathname);
}

function getReelIdFromPath() {
    const match = window.location.pathname.match(/\/reels?\/([^/]+)/i);
    return match ? match[1] : "";
}

function safeGetSelectedPackage() {
    if (!reelsAlive) {
        return Promise.resolve(DEFAULT_PACKAGE);
    }

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get(["selectedPackage"], result => {
                    if (chrome.runtime?.lastError) {
                        const runtimeError = new Error(chrome.runtime.lastError.message);
                        if (isContextInvalidatedError(runtimeError)) {
                            shutdownReels("extension context invalidated");
                        }
                        resolve(DEFAULT_PACKAGE);
                        return;
                    }
                    resolve(result?.selectedPackage || DEFAULT_PACKAGE);
                });
            });
        }
    } catch (error) {
        if (isContextInvalidatedError(error)) {
            shutdownReels("extension context invalidated");
            return Promise.resolve(DEFAULT_PACKAGE);
        }
        console.warn("Reels storage access failed:", error);
    }

    return Promise.resolve(DEFAULT_PACKAGE);
}

async function getReelFilterConfig(packageName) {
    if (cachedReelConfig && cachedReelPackage === packageName) {
        return cachedReelConfig;
    }

    const config = await getPackageConfigAsync(packageName);
    cachedReelPackage = packageName;
    cachedReelConfig = config;
    return config;
}

function invalidateReelConfigCache() {
    cachedReelConfig = null;
    cachedReelPackage = "";
    lastDecisionReelId = "";
}

function collectReelText(element) {
    if (!element || element === document.body || element === document.documentElement) {
        return "";
    }

    const parts = [];
    const ariaLabel = element.getAttribute?.("aria-label") || element.getAttribute?.("alt") || "";
    if (ariaLabel) {
        parts.push(ariaLabel);
    }

    element.querySelectorAll("span[dir='auto'], h1, h2, figcaption, a[role='link']").forEach(node => {
        const value = node.innerText || node.textContent || "";
        if (value.trim()) {
            parts.push(value.trim());
        }
    });

    return [...new Set(parts)].join("\n");
}

function getCurrentReelText() {
    const video = document.querySelector("video");
    if (!video) {
        return "";
    }

    const root = video.closest("article");
    if (!root) {
        return "";
    }

    return collectReelText(root);
}

function getGridReelCandidates() {
    return Array.from(document.querySelectorAll("article")).filter(article => {
        if (!article.isConnected || article.dataset.saReelProcessed === "1") {
            return false;
        }

        const hasReelLink = article.querySelector('a[href*="/reel/"], a[href*="/reels/"]');
        const hasVideo = article.querySelector("video");
        return Boolean(hasReelLink || hasVideo);
    });
}

function hideReelCard(element) {
    if (!element || !element.isConnected || element.tagName !== "ARTICLE") {
        return;
    }

    element.dataset.saReelProcessed = "1";
    element.setAttribute("aria-hidden", "true");
    element.style.opacity = "0.12";
    element.style.pointerEvents = "none";
}

function skipCurrentReel() {
    const now = Date.now();
    if (now - lastSkipAt < SKIP_COOLDOWN_MS) {
        return false;
    }

    const nextButton = document.querySelector(
        [
            'button[aria-label*="Next"]',
            'button[aria-label*="next"]',
            'button[aria-label*="다음"]',
            '[role="button"][aria-label*="Next"]',
            '[role="button"][aria-label*="next"]',
            '[role="button"][aria-label*="다음"]'
        ].join(", ")
    );

    if (!nextButton || typeof nextButton.click !== "function") {
        return false;
    }

    lastSkipAt = now;
    nextButton.click();
    return true;
}

async function filterReelViewer(packageName, config) {
    const reelId = getReelIdFromPath();
    if (!reelId) {
        return { hiddenCount: 0, keptCount: 0, skipped: false };
    }

    const currentText = getCurrentReelText();
    if (!currentText) {
        return { hiddenCount: 0, keptCount: 0, skipped: false };
    }

    if (lastDecisionReelId === reelId) {
        return { hiddenCount: 0, keptCount: 1, skipped: false };
    }

    const score = calculateScore(currentText, packageName, config);
    lastDecisionReelId = reelId;

    if (score < 0) {
        const skipped = skipCurrentReel();
        return { hiddenCount: 0, keptCount: 0, skipped };
    }

    return { hiddenCount: 0, keptCount: 1, skipped: false };
}

async function filterReelGrid(packageName, config) {
    const candidates = getGridReelCandidates();
    let hiddenCount = 0;
    let keptCount = 0;

    candidates.forEach(candidate => {
        const text = collectReelText(candidate);
        if (!text) {
            return;
        }

        const score = calculateScore(text, packageName, config);
        if (score < 0) {
            hideReelCard(candidate);
            hiddenCount += 1;
        } else {
            keptCount += 1;
        }
    });

    return { hiddenCount, keptCount, skipped: false };
}

async function runInstagramReelsFilter() {
    if (!isInstagramHost || !reelsAlive || document.visibilityState !== "visible") {
        return;
    }

    if (reelsProcessing) {
        pendingReelReprocess = true;
        return;
    }

    reelsProcessing = true;

    try {
        const packageName = await safeGetSelectedPackage();
        const config = await getReelFilterConfig(packageName);
        const currentPath = window.location.pathname;
        const pathChanged = currentPath !== lastReelPath;
        const packageChanged = packageName !== lastReelPackage;

        if (pathChanged || packageChanged) {
            lastDecisionReelId = "";
            lastReelPackage = packageName;
            lastReelPath = currentPath;
        }

        let result = { hiddenCount: 0, keptCount: 0, skipped: false };
        if (isReelViewerPage()) {
            result = await filterReelViewer(packageName, config);
        } else if (isReelsTabPage()) {
            result = await filterReelGrid(packageName, config);
        }

        if (result.hiddenCount > 0 || result.skipped) {
            console.log(
                `[Set Algorithm - Reels] ${packageName}: ${result.hiddenCount}개 숨김` +
                (result.skipped ? ", 현재 릴스 스킵" : "")
            );
        }
    } catch (error) {
        if (isContextInvalidatedError(error)) {
            shutdownReels("extension context invalidated");
            return;
        }
        console.warn("Reels filter failed (will retry):", error);
    } finally {
        reelsProcessing = false;

        if (pendingReelReprocess) {
            pendingReelReprocess = false;
            runInstagramReelsFilter();
        }
    }
}

function scheduleWakeup() {
    if (!reelsAlive || !isInstagramHost) {
        return;
    }

    clearTimeout(wakeupTimer);
    wakeupTimer = setTimeout(() => {
        if (document.visibilityState === "visible") {
            lastDecisionReelId = "";
            runInstagramReelsFilter();
        }
    }, 500);
}

if (isInstagramHost) {
    window.addEventListener("pageshow", scheduleWakeup);
    window.addEventListener("focus", scheduleWakeup);
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            scheduleWakeup();
        }
    });

    if (reelsTimer) {
        clearInterval(reelsTimer);
    }

    reelsTimer = setInterval(runInstagramReelsFilter, REEL_POLL_MS);

    setTimeout(runInstagramReelsFilter, 1200);

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === "local" && (changes.selectedPackage || changes.customKeywords)) {
                invalidateReelConfigCache();
                scheduleWakeup();
            }
        });
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message?.type === "SET_ALGORITHM_REFRESH") {
                invalidateReelConfigCache();
                scheduleWakeup();
                try {
                    sendResponse({ ok: true });
                } catch (error) {
                    if (isContextInvalidatedError(error)) {
                        shutdownReels("extension context invalidated");
                        return false;
                    }
                }
                return true;
            }
            return false;
        });
    }

    console.log("Set Algorithm Reels 실행됨");
}
