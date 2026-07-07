// ================================
// Set Algorithm - content.js
// ================================

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
    return Array.from(
        document.querySelectorAll(
            "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer"
        )
    );
}

function extractVideoText(video) {
    const title =
        video.querySelector("h3, h4, yt-formatted-string, #video-title, #title")?.innerText || "";
    const meta =
        video.querySelector("#metadata, #channel-name, #text")?.innerText || "";
    return [title, meta, video.innerText].join("\n");
}

async function applyPackageFilter(packageName) {
    const videos = getVideoCandidates();
    let hiddenCount = 0;
    let visibleCount = 0;

    const config = await getPackageConfigAsync(packageName);

    videos.forEach(video => {
        if (!video || !video.isConnected) {
            return;
        }

        const text = extractVideoText(video);
        const score = calculateScore(text, packageName, config);

        if (score <= 0) {
            video.style.display = "none";
            video.dataset.saProcessed = "1";
            hiddenCount += 1;
        } else {
            video.style.display = "";
            video.dataset.saProcessed = "1";
            visibleCount += 1;
        }
    });

    await safeStorageSet({
        filterStats: {
            total: videos.length,
            kept: visibleCount,
            removed: hiddenCount
        }
    });

    if (hiddenCount > 0 || visibleCount > 0) {
        console.log(`[Set Algorithm] ${packageName}: ${hiddenCount}개 숨김, ${visibleCount}개 유지`);
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
window.addEventListener("beforeunload", () => {
    contentAlive = false;
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes.selectedPackage || changes.customKeywords || changes.filterStats)) {
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

console.log("Set Algorithm 실행됨");