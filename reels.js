let reelsProcessing = false;
let lastReelPackage = "";
let lastReelUrl = "";
let reelsAlive = true;
let reelsTimer = null;
let pendingReelReprocess = false;

function safeGetSelectedPackage() {
    if (!reelsAlive) {
        return Promise.resolve(DEFAULT_PACKAGE);
    }

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get(["selectedPackage"], result => {
                    if (!reelsAlive) {
                        resolve(DEFAULT_PACKAGE);
                        return;
                    }
                    console.log("[Set Algorithm] reels loaded storage", result);
                    resolve(result.selectedPackage || DEFAULT_PACKAGE);
                });
            });
        }
    } catch (error) {
        reelsAlive = false;
        console.warn("Reels storage access failed:", error);
    }

    return Promise.resolve(DEFAULT_PACKAGE);
}

function collectReelText(element) {
    if (!element) {
        return "";
    }

    const parts = [];
    const ariaLabel = element.getAttribute("aria-label") || element.getAttribute("alt") || "";
    if (ariaLabel) {
        parts.push(ariaLabel);
    }

    const text = element.innerText || element.textContent || "";
    if (text) {
        parts.push(text);
    }

    return parts.join("\n");
}

function getReelCandidates() {
    const candidates = new Set();

    document.querySelectorAll('a[href*="/reel/"]').forEach(link => {
        const container = link.closest("article, div[role='button'], div[role='presentation'], section, main");
        if (container) {
            candidates.add(container);
        }
        candidates.add(link);
    });

    document.querySelectorAll("video").forEach(video => {
        const container = video.closest("article, div[role='button'], section, main");
        if (container && container.textContent && container.textContent.trim().length > 10) {
            candidates.add(container);
        }
    });

    return Array.from(candidates).filter(element => {
        if (!element || !element.isConnected) {
            return false;
        }

        const text = collectReelText(element);
        return text.trim().length > 0;
    });
}

function hideReelCard(element) {
    if (!element || !element.isConnected) {
        return;
    }

    element.style.display = "none";
    element.dataset.saReelProcessed = "1";
}

function skipCurrentReel() {
    const nextButton = document.querySelector(
        'button[aria-label*="Next"], button[aria-label*="다음"], [role="button"][aria-label*="Next"], [role="button"][aria-label*="다음"]'
    );

    if (nextButton) {
        nextButton.click();
        return true;
    }

    const nextLink = Array.from(document.querySelectorAll('a[href*="/reel/"]')).find(link => {
        const href = link.getAttribute("href") || "";
        return href && !href.includes(window.location.pathname);
    });

    if (nextLink) {
        window.location.href = nextLink.href;
        return true;
    }

    window.scrollTo({ top: window.scrollY + window.innerHeight, behavior: "smooth" });
    return false;
}

async function runInstagramReelsFilter() {
    if (!reelsAlive) {
        return;
    }

    if (reelsProcessing) {
        pendingReelReprocess = true;
        return;
    }

    reelsProcessing = true;

    try {
        const packageName = await safeGetSelectedPackage();

        if (packageName !== lastReelPackage || window.location.href !== lastReelUrl) {
            lastReelPackage = packageName;
            lastReelUrl = window.location.href;
        }

        const candidates = getReelCandidates();
        let hiddenCount = 0;

        candidates.forEach(candidate => {
            const text = collectReelText(candidate);
            const score = calculateScore(text, packageName);

            if (score <= 0) {
                hideReelCard(candidate);
                hiddenCount += 1;
            }
        });

        const isReelPage = window.location.pathname.includes("/reel/");
        if (isReelPage) {
            const currentText = collectReelText(document.body);
            const score = calculateScore(currentText, packageName);
            if (score <= 0) {
                skipCurrentReel();
            }
        }

        if (hiddenCount > 0 || isReelPage) {
            console.log(`[Set Algorithm - Reels] ${packageName}: ${hiddenCount}개 카드 숨김`);
        }
    } catch (error) {
        reelsAlive = false;
        console.warn("Reels filter failed:", error);
    } finally {
        reelsProcessing = false;

        if (pendingReelReprocess) {
            pendingReelReprocess = false;
            runInstagramReelsFilter();
        }
    }
}

createObserver(runInstagramReelsFilter);
window.addEventListener("load", runInstagramReelsFilter);
window.addEventListener("popstate", runInstagramReelsFilter);

if (reelsTimer) {
    clearInterval(reelsTimer);
}
reelsTimer = setInterval(runInstagramReelsFilter, 4000);

window.addEventListener("beforeunload", () => {
    reelsAlive = false;
    if (reelsTimer) {
        clearInterval(reelsTimer);
    }
});

console.log("Set Algorithm Reels 실행됨");
