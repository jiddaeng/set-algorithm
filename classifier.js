const packageModule = typeof require === "function" ? require("./packages.js") : null;
const PACKAGE_CONFIG_LOCAL = typeof PACKAGE_CONFIG !== "undefined" ? PACKAGE_CONFIG : (packageModule && packageModule.PACKAGE_CONFIG) || {};
const DEFAULT_PACKAGE_LOCAL = typeof DEFAULT_PACKAGE !== "undefined" ? DEFAULT_PACKAGE : (packageModule && packageModule.DEFAULT_PACKAGE) || "study";

function normalizeText(text) {
    return String(text || "").toLowerCase();
}

function resolvePackageName(packageName) {
    const normalized = normalizeText(packageName).replace(/[^a-z]/g, "");

    if (normalized === "studypack" || normalized === "study") {
        return "study";
    }

    if (normalized === "workoutpack" || normalized === "workout" || normalized === "fitness") {
        return "workout";
    }

    if (normalized === "developmentpack" || normalized === "development" || normalized === "dev") {
        return "development";
    }

    if (normalized === "readingpack" || normalized === "reading" || normalized === "book") {
        return "reading";
    }

    return DEFAULT_PACKAGE_LOCAL;
}

function normalizeCustomKeywordsForPackage(rawKeywords, packageName) {
    if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
        return { include: [], exclude: [] };
    }

    if (rawKeywords.include || rawKeywords.exclude) {
        return {
            include: [...(rawKeywords.include || [])],
            exclude: [...(rawKeywords.exclude || [])]
        };
    }

    const resolvedName = resolvePackageName(packageName);
    const entry = rawKeywords[resolvedName] || rawKeywords[resolvedName.toLowerCase()] || rawKeywords[packageName] || rawKeywords[packageName?.toLowerCase()] || {};
    return {
        include: [...(entry.include || [])],
        exclude: [...(entry.exclude || [])]
    };
}

async function getPackageConfigAsync(packageName) {
    const resolvedName = resolvePackageName(packageName);
    const config = PACKAGE_CONFIG_LOCAL[resolvedName] || PACKAGE_CONFIG_LOCAL[DEFAULT_PACKAGE_LOCAL];

    if (typeof chrome === "undefined" || !chrome.storage?.local) {
        return config;
    }

    return new Promise(resolve => {
        try {
            chrome.storage.local.get(["customKeywords"], result => {
                if (chrome.runtime?.lastError) {
                    resolve(config);
                    return;
                }
                const customKeywords = normalizeCustomKeywordsForPackage(result.customKeywords, resolvedName);
                resolve({
                    ...config,
                    include: [...config.include, ...(customKeywords.include || [])],
                    exclude: [...config.exclude, ...(customKeywords.exclude || [])]
                });
            });
        } catch (error) {
            console.warn("Package config storage access failed:", error);
            resolve(config);
        }
    });
}

function getPackageConfig(packageName) {
    const resolvedName = resolvePackageName(packageName);
    return PACKAGE_CONFIG_LOCAL[resolvedName] || PACKAGE_CONFIG_LOCAL[DEFAULT_PACKAGE_LOCAL];
}

function getMatchedIncludeKeywords(title, packageName = DEFAULT_PACKAGE_LOCAL, configOverride = null) {
    const text = normalizeText(title);
    const config = configOverride || getPackageConfig(packageName);

    return (config.include || []).filter(keyword => {
        const normalizedKeyword = normalizeText(keyword);
        return normalizedKeyword && text.includes(normalizedKeyword);
    });
}

function calculateScore(title, packageName = DEFAULT_PACKAGE_LOCAL, configOverride = null) {
    const text = normalizeText(title);
    const config = configOverride || getPackageConfig(packageName);
    let score = 0;

    config.include.forEach(keyword => {
        if (text.includes(normalizeText(keyword))) {
            score += 10;
        }
    });

    config.exclude.forEach(keyword => {
        if (text.includes(normalizeText(keyword))) {
            score -= 20;
        }
    });

    return score;
}

if (typeof window !== "undefined") {
    window.calculateScore = calculateScore;
    window.getPackageConfig = getPackageConfig;
    window.getMatchedIncludeKeywords = getMatchedIncludeKeywords;
}

if (typeof module !== "undefined") {
    module.exports = {
        calculateScore,
        getPackageConfig,
        getPackageConfigAsync,
        normalizeCustomKeywordsForPackage,
        getMatchedIncludeKeywords,
        resolvePackageName
    };
}