let shortsProcessing = false;
let shortsAlive = true;
let shortsTimer = null;
let pathWatchTimer = null;
let pendingShortsReprocess = false;
let lastShortPackage = "";
let lastShortPath = "";
let lastSeenShortId = "";
let lastKeptShortId = "";
let lastSkipAt = 0;
let cachedShortConfig = null;
let cachedShortPackage = "";
let fastSkipStyleInjected = false;
let lastSkippedShortId = "";

const SHORT_POLL_MS = 300;
const PATH_WATCH_MS = 120;
const SKIP_COOLDOWN_MS = 300;
const TEXT_RETRY_LIMIT = 15;
const textRetryCountById = new Map();
const SHORTS_NOISE_KEYWORDS = new Set(["shorts", "#shorts"]);

function isShortsViewerPage() {
    return /^\/shorts\/[^/]+/i.test(window.location.pathname);
}

function getShortIdFromPath() {
    const match = window.location.pathname.match(/\/shorts\/([^/?#]+)/i);
    return match ? match[1] : "";
}

function isContextInvalidatedError(error) {
    return String(error?.message || error || "").includes("Extension context invalidated");
}

function shutdownShorts(reason = "") {
    shortsAlive = false;
    if (shortsTimer) {
        clearInterval(shortsTimer);
        shortsTimer = null;
    }
    if (pathWatchTimer) {
        clearInterval(pathWatchTimer);
        pathWatchTimer = null;
    }
    if (reason) {
        console.warn(`[Set Algorithm - Shorts] stopped: ${reason}`);
    }
}

function resetShortSession() {
    lastKeptShortId = "";
    lastSkippedShortId = "";
    lastSkipAt = 0;
}

function handleShortIdChange(shortId) {
    if (!shortId || shortId === lastSeenShortId) {
        return false;
    }

    lastSeenShortId = shortId;
    lastShortPath = window.location.pathname;
    textRetryCountById.delete(shortId);
    resetShortSession();
    return true;
}

function safeGetSelectedPackage() {
    if (!shortsAlive) {
        return Promise.resolve(DEFAULT_PACKAGE);
    }

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get(["selectedPackage"], result => {
                    if (chrome.runtime?.lastError) {
                        const runtimeError = new Error(chrome.runtime.lastError.message);
                        if (isContextInvalidatedError(runtimeError)) {
                            shutdownShorts("extension context invalidated");
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
            shutdownShorts("extension context invalidated");
            return Promise.resolve(DEFAULT_PACKAGE);
        }
    }

    return Promise.resolve(DEFAULT_PACKAGE);
}

function getShortsScoringConfig(config) {
    return {
        ...config,
        exclude: (config.exclude || []).filter(keyword => {
            const normalized = String(keyword || "").toLowerCase().replace(/^#/, "");
            return !SHORTS_NOISE_KEYWORDS.has(normalized);
        })
    };
}

async function getShortFilterConfig(packageName) {
    if (cachedShortConfig && cachedShortPackage === packageName) {
        return cachedShortConfig;
    }

    const config = await getPackageConfigAsync(packageName);
    cachedShortPackage = packageName;
    cachedShortConfig = getShortsScoringConfig(config);
    return cachedShortConfig;
}

function invalidateShortConfigCache() {
    cachedShortConfig = null;
    cachedShortPackage = "";
    resetShortSession();
}

function injectFastSkipStyles() {
    if (fastSkipStyleInjected) {
        return;
    }

    fastSkipStyleInjected = true;
    document.documentElement.classList.add("sa-shorts-fast-skip");

    const style = document.createElement("style");
    style.id = "sa-shorts-fast-skip-style";
    style.textContent = `
        html.sa-shorts-fast-skip ytd-shorts,
        html.sa-shorts-fast-skip #shorts-container,
        html.sa-shorts-fast-skip #shorts-container *,
        html.sa-shorts-fast-skip ytd-reel-video-renderer,
        html.sa-shorts-fast-skip ytd-shorts #contents,
        html.sa-shorts-fast-skip [is-scrollable] {
            scroll-behavior: auto !important;
            transition: none !important;
            animation: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function queryDeep(selector, root = document) {
    const direct = root.querySelector?.(selector);
    if (direct) {
        return direct;
    }

    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const node of nodes) {
        if (node.shadowRoot) {
            const found = queryDeep(selector, node.shadowRoot);
            if (found) {
                return found;
            }
        }
    }

    return null;
}

function getCurrentShortRoot() {
    const video = document.querySelector("video");
    if (!video) {
        return null;
    }

    return video.closest("ytd-reel-video-renderer") || video.closest("[data-overlay-video-id]") || video.parentElement;
}

function collectShortText() {
    const root = getCurrentShortRoot();
    if (!root) {
        return "";
    }

    const parts = [];

    const selectors = [
        "h1 yt-formatted-string",
        "h2 yt-formatted-string",
        "ytd-reel-player-overlay-renderer #video-title",
        "h2.ytShortsVideoTitleViewModelShortsVideoTitle",
        "yt-formatted-string#video-title",
        "#title yt-formatted-string",
        "ytd-channel-name #text",
        "#channel-name #text",
        "ytd-text-inline-expander yt-formatted-string",
        "#description-inline-expander yt-formatted-string"
    ];

    selectors.forEach(selector => {
        root.querySelectorAll(selector).forEach(node => {
            const value = (node.innerText || node.textContent || "").trim();
            if (value) {
                parts.push(value);
            }
        });
    });

    if (!parts.length) {
        const fallback = (root.innerText || root.textContent || "").trim();
        if (fallback) {
            parts.push(fallback.slice(0, 500));
        }
    }

    return [...new Set(parts)].join("\n");
}

function shouldSkipShort(text, packageName, config) {
    const score = calculateScore(text, packageName, config);
    // Keep only when include keywords win (score > 0). Neutral/negative shorts are skipped.
    return { skip: score <= 0, score };
}

function normalizeShortTextForScoring(text) {
    return String(text || "")
        .replace(/#shorts/gi, " ")
        .replace(/\byoutube shorts\b/gi, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getVisibleReelIndex(reels) {
    return reels.findIndex(reel => {
        const rect = reel.getBoundingClientRect();
        return rect.height > 0 && rect.top >= -40 && rect.top < window.innerHeight * 0.6;
    });
}

function dispatchArrowDown() {
    const video = document.querySelector("video");
    if (video && typeof video.focus === "function") {
        video.focus();
    }

    const target = document.activeElement || document.body;
    const init = {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true
    };

    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
}

function scrollToNextReel() {
    const reels = Array.from(document.querySelectorAll("ytd-reel-video-renderer, ytd-shorts #content ytd-reel-video-renderer"));
    if (!reels.length) {
        return false;
    }

    const currentIndex = getVisibleReelIndex(reels);
    const nextReel = currentIndex >= 0 ? reels[currentIndex + 1] : reels[1];
    if (!nextReel) {
        return false;
    }

    nextReel.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
    return true;
}

function skipCurrentShort() {
    const now = Date.now();
    if (now - lastSkipAt < SKIP_COOLDOWN_MS) {
        return false;
    }

    lastSkipAt = now;
    injectFastSkipStyles();

    const nextButton = queryDeep(
        [
            "#navigation-button-down button",
            "#navigation-button-down",
            'button[aria-label*="Next video"]',
            'button[aria-label*="Next Short"]',
            'button[aria-label*="다음 동영상"]',
            'button[aria-label*="다음"]',
            'yt-icon-button[aria-label*="Next"]',
            'yt-icon-button[aria-label*="다음"]'
        ].join(", ")
    );

    if (nextButton && typeof nextButton.click === "function") {
        nextButton.click();
    }

    scrollToNextReel();

    const scrollHost = queryDeep("ytd-shorts #contents, #shorts-container, [is-scrollable]");
    if (scrollHost) {
        scrollHost.scrollTop += window.innerHeight;
        scrollHost.dispatchEvent(new WheelEvent("wheel", {
            deltaY: 1400,
            bubbles: true,
            cancelable: true
        }));
    }

    dispatchArrowDown();
    return true;
}

async function filterCurrentShort(packageName, config) {
    const shortId = getShortIdFromPath();
    if (!shortId) {
        return { skipped: false, kept: false, score: 0 };
    }

    if (lastKeptShortId === shortId) {
        return { skipped: false, kept: true, score: 1, matchedKeywords: null };
    }

    if (lastSkippedShortId === shortId) {
        return { skipped: false, kept: false, score: 0, matchedKeywords: null };
    }

    const rawText = collectShortText();
    if (!rawText) {
        const retries = textRetryCountById.get(shortId) || 0;
        if (retries < TEXT_RETRY_LIMIT) {
            textRetryCountById.set(shortId, retries + 1);
        }
        return { skipped: false, kept: false, score: 0 };
    }

    textRetryCountById.delete(shortId);

    const text = normalizeShortTextForScoring(rawText);
    const decision = shouldSkipShort(text, packageName, config);
    const matchedKeywords = getMatchedIncludeKeywords(text, packageName, config);

    if (decision.skip) {
        lastSkippedShortId = shortId;
        skipCurrentShort();
        return { skipped: true, kept: false, score: decision.score, matchedKeywords: null };
    }

    lastKeptShortId = shortId;
    return { skipped: false, kept: true, score: decision.score, matchedKeywords };
}

async function runShortsFilter() {
    if (!shortsAlive || !isShortsViewerPage() || document.visibilityState !== "visible") {
        return;
    }

    if (shortsProcessing) {
        pendingShortsReprocess = true;
        return;
    }

    shortsProcessing = true;
    injectFastSkipStyles();

    try {
        const packageName = await safeGetSelectedPackage();
        const config = await getShortFilterConfig(packageName);
        const shortId = getShortIdFromPath();
        const packageChanged = packageName !== lastShortPackage;

        if (handleShortIdChange(shortId)) {
            lastShortPackage = packageName;
        } else if (packageChanged) {
            lastShortPackage = packageName;
            resetShortSession();
        }

        const result = await filterCurrentShort(packageName, config);

        if (result.skipped) {
            console.log(`[Set Algorithm - Shorts] ${packageName}: 숏츠 스킵 (score ${result.score})`);
            setTimeout(runShortsFilter, 100);
        } else if (result.kept && result.matchedKeywords) {
            console.log(
                `[Set Algorithm - Shorts] ${packageName}: 숏츠 유지 (score ${result.score}) [${result.matchedKeywords.join(", ") || "없음"}]`
            );
        }
    } catch (error) {
        if (isContextInvalidatedError(error)) {
            shutdownShorts("extension context invalidated");
            return;
        }
        console.warn("Shorts filter failed (will retry):", error);
    } finally {
        shortsProcessing = false;

        if (pendingShortsReprocess) {
            pendingShortsReprocess = false;
            runShortsFilter();
        }
    }
}

function scheduleShortsWakeup() {
    if (!shortsAlive) {
        return;
    }

    resetShortSession();
    setTimeout(runShortsFilter, 0);
}

if (window.location.hostname.includes("youtube.com")) {
    injectFastSkipStyles();
    lastSeenShortId = getShortIdFromPath();

    window.addEventListener("yt-navigate-finish", scheduleShortsWakeup);
    window.addEventListener("pageshow", scheduleShortsWakeup);
    window.addEventListener("focus", scheduleShortsWakeup);
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            scheduleShortsWakeup();
        }
    });

    shortsTimer = setInterval(runShortsFilter, SHORT_POLL_MS);
    pathWatchTimer = setInterval(() => {
        if (handleShortIdChange(getShortIdFromPath())) {
            runShortsFilter();
        }
    }, PATH_WATCH_MS);

    setTimeout(runShortsFilter, 200);

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === "local" && (changes.selectedPackage || changes.customKeywords)) {
                invalidateShortConfigCache();
                scheduleShortsWakeup();
            }
        });
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message?.type === "SET_ALGORITHM_REFRESH") {
                invalidateShortConfigCache();
                scheduleShortsWakeup();
                try {
                    sendResponse({ ok: true });
                } catch (error) {
                    if (isContextInvalidatedError(error)) {
                        shutdownShorts("extension context invalidated");
                        return false;
                    }
                }
                return true;
            }
            return false;
        });
    }

    console.log("Set Algorithm Shorts 실행됨");
}
