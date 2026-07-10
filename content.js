// ================================
// Set Algorithm - YouTube content filter
// ================================

const YOUTUBE_VIDEO_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-compact-movie-renderer",
    "ytd-compact-playlist-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-reel-video-renderer",
    "ytd-playlist-renderer",
    "ytd-radio-renderer",
    "yt-lockup-view-model"
].join(", ");

let isProcessing = false;
let lastPackageName = DEFAULT_PACKAGE;
let contentAlive = true;
let pendingContentReprocess = false;
let youtubeFilterTimer = null;
let activeSyncTimer = null;
const YOUTUBE_IDLE_DELAY = 1200;
const ACTIVE_SYNC_INTERVAL_MS = 5000;

function safeStorageGet(keys, fallback = {}) {
    if (!contentAlive || typeof chrome === "undefined" || !chrome.storage?.local) {
        return Promise.resolve(fallback);
    }

    return new Promise(resolve => {
        try {
            chrome.storage.local.get(keys, result => {
                if (!contentAlive) {
                    resolve(fallback);
                    return;
                }
                resolve(result || fallback);
            });
        } catch (error) {
            contentAlive = false;
            console.warn("Set Algorithm storage read failed:", error);
            resolve(fallback);
        }
    });
}

function safeStorageSet(data) {
    if (!contentAlive || typeof chrome === "undefined" || !chrome.storage?.local) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        try {
            chrome.storage.local.set(data, () => resolve());
        } catch (error) {
            contentAlive = false;
            console.warn("Set Algorithm storage write failed:", error);
            resolve();
        }
    });
}

function getVideoCandidates() {
    return Array.from(
        document.querySelectorAll(
            YOUTUBE_VIDEO_SELECTOR
        )
    );
}

function readTextOrAttribute(root, selector, attribute = "") {
    return Array.from(root.querySelectorAll(selector))
        .map(element => attribute
            ? element.getAttribute(attribute) || ""
            : element.innerText || element.textContent || "")
        .filter(Boolean)
        .join("\n");
}

function isVideoRelatedMutation(mutation) {
    const target = mutation.target?.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target?.parentElement;

    if (target?.closest?.(YOUTUBE_VIDEO_SELECTOR)) {
        return true;
    }

    return Array.from(mutation.addedNodes || []).some(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        return node.matches?.(YOUTUBE_VIDEO_SELECTOR) || Boolean(node.querySelector?.(YOUTUBE_VIDEO_SELECTOR));
    });
}

function scheduleYouTubeFilter(delay = YOUTUBE_IDLE_DELAY) {
    if (!contentAlive) {
        return;
    }

    clearTimeout(youtubeFilterTimer);
    youtubeFilterTimer = setTimeout(() => {
        youtubeFilterTimer = null;
        runSetAlgorithm();
    }, delay);
}

function observeYouTubeVideoLoading() {
    const observer = new MutationObserver(mutations => {
        if (mutations.some(isVideoRelatedMutation)) {
            scheduleYouTubeFilter();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    scheduleYouTubeFilter();
    return observer;
}

function requestActiveRemoteSync() {
    if (window.location.hostname !== "www.youtube.com" || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        return;
    }

    chrome.runtime.sendMessage({ type: "SET_ALGORITHM_ACTIVE_SYNC" }, () => {
        chrome.runtime.lastError;
    });
}

function startActiveRemoteSync() {
    if (window.location.hostname !== "www.youtube.com") {
        return;
    }

    requestActiveRemoteSync();
    activeSyncTimer = setInterval(requestActiveRemoteSync, ACTIVE_SYNC_INTERVAL_MS);
}

function extractVideoText(video) {
    const parts = [
        video.getAttribute("aria-label") || "",
        video.getAttribute("title") || "",
        video.getAttribute("data-title") || "",
        readTextOrAttribute(video, "#video-title", "title"),
        readTextOrAttribute(video, "#video-title"),
        readTextOrAttribute(video, "a#video-title-link", "title"),
        readTextOrAttribute(video, "a#video-title-link"),
        readTextOrAttribute(video, 'a[href*="/watch"]', "aria-label"),
        readTextOrAttribute(video, 'a[href*="/watch"]', "title"),
        readTextOrAttribute(video, 'a[href*="/shorts/"]', "aria-label"),
        readTextOrAttribute(video, 'a[href*="/shorts/"]', "title"),
        readTextOrAttribute(video, "yt-formatted-string#video-title"),
        readTextOrAttribute(video, ".yt-core-attributed-string"),
        readTextOrAttribute(video, "h3"),
        readTextOrAttribute(video, "h4"),
        readTextOrAttribute(video, "#metadata"),
        readTextOrAttribute(video, "#channel-name"),
        readTextOrAttribute(video, "#text"),
        video.innerText || video.textContent || ""
    ];

    return parts.filter(Boolean).join("\n");
}

function setVideoVisibility(video, shouldKeep) {
    video.style.display = shouldKeep ? "" : "none";
    video.dataset.saProcessed = "1";
}

async function getFilterState(packageName) {
    const result = await safeStorageGet(["filterMode"], {});
    const config = await getPackageConfigAsync(packageName);

    return {
        config,
        filterMode: normalizeFilterMode(result.filterMode || "purpose")
    };
}

async function applyPackageFilter(packageName) {
    const videos = getVideoCandidates();
    let hiddenCount = 0;
    let visibleCount = 0;
    const { config, filterMode } = await getFilterState(packageName);

    videos.forEach(video => {
        if (!video || !video.isConnected) {
            return;
        }

        const text = extractVideoText(video);
        const shouldKeep = shouldKeepContent(text, packageName, config, filterMode);
        setVideoVisibility(video, shouldKeep);

        if (shouldKeep) {
            visibleCount += 1;
        } else {
            hiddenCount += 1;
        }
    });

    await safeStorageSet({
        filterStats: {
            total: videos.length,
            kept: visibleCount,
            removed: hiddenCount,
            filterMode,
            packageName,
            updatedAt: new Date().toISOString()
        }
    });

    if (hiddenCount > 0 || visibleCount > 0) {
        console.log(`[Set Algorithm] ${packageName}/${filterMode}: hidden ${hiddenCount}, kept ${visibleCount}`);
    }
}

async function getSelectedPackage() {
    const result = await safeStorageGet(["selectedPackage"], {});
    return result.selectedPackage || DEFAULT_PACKAGE;
}

async function runSetAlgorithm() {
    if (!contentAlive) {
        return;
    }

    if (isProcessing) {
        pendingContentReprocess = true;
        return;
    }

    isProcessing = true;

    try {
        const packageName = await getSelectedPackage();

        if (packageName !== lastPackageName) {
            lastPackageName = packageName;
        }

        await applyPackageFilter(packageName);
    } catch (error) {
        contentAlive = false;
        console.warn("Set Algorithm run failed:", error);
    } finally {
        isProcessing = false;

        if (pendingContentReprocess) {
            pendingContentReprocess = false;
            scheduleYouTubeFilter();
        }
    }
}

observeYouTubeVideoLoading();
startActiveRemoteSync();
window.addEventListener("load", () => scheduleYouTubeFilter());
window.addEventListener("yt-navigate-finish", () => scheduleYouTubeFilter());
window.addEventListener("beforeunload", () => {
    contentAlive = false;
    clearTimeout(youtubeFilterTimer);
    clearInterval(activeSyncTimer);
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes.selectedPackage || changes.customKeywords)) {
            scheduleYouTubeFilter(250);
        }
    });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "SET_ALGORITHM_REFRESH") {
            scheduleYouTubeFilter(250);
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
}

console.log("Set Algorithm 실행됨");
