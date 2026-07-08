// ================================
// Set Algorithm - YouTube content filter
// ================================

const YOUTUBE_VIDEO_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-playlist-renderer",
    "ytd-radio-renderer"
].join(", ");

let isProcessing = false;
let lastPackageName = DEFAULT_PACKAGE;
let contentAlive = true;
let pendingContentReprocess = false;

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
    if (!location.hostname.includes("youtube.com")) {
        return [];
    }

    return Array.from(document.querySelectorAll(YOUTUBE_VIDEO_SELECTOR));
}

function readTextOrAttribute(element, selector, attribute = null) {
    const target = element.querySelector(selector);
    if (!target) {
        return "";
    }

    if (attribute) {
        return target.getAttribute(attribute) || "";
    }

    return target.innerText || target.textContent || "";
}

function extractVideoText(video) {
    const parts = [
        video.getAttribute("aria-label") || "",
        video.getAttribute("title") || "",
        readTextOrAttribute(video, "#video-title", "title"),
        readTextOrAttribute(video, "#video-title"),
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
            runSetAlgorithm();
        }
    }
}

createObserver(runSetAlgorithm);
window.addEventListener("load", runSetAlgorithm);
window.addEventListener("yt-navigate-finish", runSetAlgorithm);
window.addEventListener("beforeunload", () => {
    contentAlive = false;
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes.selectedPackage || changes.customKeywords || changes.filterMode)) {
            runSetAlgorithm();
        }
    });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === "SET_ALGORITHM_REFRESH") {
            runSetAlgorithm();
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
}

console.log("Set Algorithm content filter loaded");
