const REMOTE_SYNC_ALARM = "setAlgorithmRemoteSync";
let inFlightRemoteSync = null;
const DEFAULT_REMOTE_SETTINGS = {
    enabled: true,
    serverUrl: "http://localhost:3000",
    familyKey: "",
    deviceId: "",
    pollIntervalMinutes: 0.5
};

function storageGet(keys, fallback = {}) {
    return new Promise(resolve => {
        chrome.storage.local.get(keys, result => resolve(result || fallback));
    });
}

function storageSet(data) {
    return new Promise(resolve => {
        chrome.storage.local.set(data, () => resolve());
    });
}

function normalizeServerUrl(serverUrl) {
    let value = String(serverUrl || DEFAULT_REMOTE_SETTINGS.serverUrl).trim();
    if (!value) {
        return DEFAULT_REMOTE_SETTINGS.serverUrl;
    }

    if (!/^https?:\/\//i.test(value)) {
        const isLocalAddress = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(value);
        value = `${isLocalAddress ? "http" : "https"}://${value}`;
    }

    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) {
            return DEFAULT_REMOTE_SETTINGS.serverUrl;
        }
        return url.href.replace(/\/+$/, "");
    } catch (error) {
        return DEFAULT_REMOTE_SETTINGS.serverUrl;
    }
}

function generateDeviceId() {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    return `kid-${suffix}`;
}

function normalizeRemoteSettings(rawSettings = {}) {
    const settings = {
        ...DEFAULT_REMOTE_SETTINGS,
        ...(rawSettings || {})
    };

    return {
        enabled: settings.enabled !== false,
        serverUrl: normalizeServerUrl(settings.serverUrl),
        familyKey: String(settings.familyKey || "").trim(),
        deviceId: String(settings.deviceId || "").trim() || generateDeviceId(),
        pollIntervalMinutes: Math.max(0.5, Number(settings.pollIntervalMinutes) || DEFAULT_REMOTE_SETTINGS.pollIntervalMinutes)
    };
}

async function ensureRemoteSettings() {
    const result = await storageGet(["remoteSettings"]);
    const currentSettings = result.remoteSettings || {};
    const settings = normalizeRemoteSettings(currentSettings);

    if (
        currentSettings.enabled !== settings.enabled ||
        currentSettings.serverUrl !== settings.serverUrl ||
        currentSettings.familyKey !== settings.familyKey ||
        currentSettings.deviceId !== settings.deviceId ||
        currentSettings.pollIntervalMinutes !== settings.pollIntervalMinutes
    ) {
        await storageSet({ remoteSettings: settings });
    }

    return settings;
}

function buildDeviceUrl(settings, path) {
    return `${settings.serverUrl}/api/devices/${encodeURIComponent(settings.deviceId)}${path}`;
}

function buildRemoteHeaders(settings, headers = {}) {
    const nextHeaders = { ...headers };
    if (settings.familyKey) {
        nextHeaders["X-Family-Key"] = settings.familyKey;
    }
    return nextHeaders;
}

async function registerDevice(settings, cachedPolicy = null) {
    await fetch(buildDeviceUrl(settings, "/register"), {
        method: "POST",
        headers: buildRemoteHeaders(settings, {
            "Content-Type": "application/json"
        }),
        body: JSON.stringify({
            extensionVersion: chrome.runtime.getManifest().version,
            userAgent: navigator.userAgent,
            registeredAt: new Date().toISOString(),
            cachedPolicy
        })
    });
}

function sanitizeKeywordsMap(rawKeywords) {
    if (!rawKeywords || typeof rawKeywords !== "object" || Array.isArray(rawKeywords)) {
        return {};
    }

    const nextKeywords = {};
    Object.entries(rawKeywords).forEach(([packageName, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return;
        }

        nextKeywords[packageName] = {
            include: Array.isArray(value.include) ? value.include.map(String).filter(Boolean) : [],
            exclude: Array.isArray(value.exclude) ? value.exclude.map(String).filter(Boolean) : []
        };
    });

    return nextKeywords;
}

function normalizeFilterModeValue(filterMode) {
    return ["purpose", "blocklist", "allowlist"].includes(filterMode) ? filterMode : "blocklist";
}

function sanitizePolicy(policy) {
    const selectedPackage = typeof policy?.selectedPackage === "string" && policy.selectedPackage.trim()
        ? policy.selectedPackage.trim()
        : "kids";

    return {
        selectedPackage,
        customKeywords: sanitizeKeywordsMap(policy?.customKeywords),
        filterMode: normalizeFilterModeValue(policy?.filterMode),
        revision: Number.isInteger(Number(policy?.revision)) && Number(policy.revision) > 0 ? Number(policy.revision) : 1,
        policyUpdatedAt: policy?.updatedAt || ""
    };
}

async function acknowledgePolicy(settings, policy) {
    const response = await fetch(buildDeviceUrl(settings, "/ack"), {
        method: "POST",
        headers: buildRemoteHeaders(settings, {
            "Content-Type": "application/json"
        }),
        body: JSON.stringify({ revision: policy.revision })
    });

    if (!response.ok) {
        throw new Error(`Policy acknowledgement failed with ${response.status}`);
    }
}

function hasSamePolicyValue(value, expected) {
    return JSON.stringify(value) === JSON.stringify(expected);
}

async function enforceParentPolicy(changes) {
    if (!changes.selectedPackage && !changes.customKeywords && !changes.filterMode) {
        return;
    }

    const result = await storageGet(["remoteSettings", "parentPolicy"]);
    const settings = normalizeRemoteSettings(result.remoteSettings || {});
    const policy = result.parentPolicy;

    if (!settings.enabled || !policy) {
        return;
    }

    const parentValues = {
        selectedPackage: policy.selectedPackage,
        customKeywords: policy.customKeywords,
        filterMode: policy.filterMode
    };
    const hasConflict = Object.entries(parentValues).some(([key, value]) =>
        changes[key] && !hasSamePolicyValue(changes[key].newValue, value)
    );

    if (hasConflict) {
        await storageSet(parentValues);
    }
}

async function notifySupportedTabs() {
    if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) {
        return;
    }

    const tabs = await chrome.tabs.query({
        url: [
            "https://www.youtube.com/*",
            "https://www.instagram.com/*"
        ]
    });

    tabs.forEach(tab => {
        if (!tab.id) {
            return;
        }

        chrome.tabs.sendMessage(tab.id, { type: "SET_ALGORITHM_REFRESH" }, () => {
            chrome.runtime.lastError;
        });
    });
}

function syncRemotePolicy(reason = "alarm") {
    if (inFlightRemoteSync) {
        return inFlightRemoteSync;
    }

    inFlightRemoteSync = runRemotePolicySync(reason).finally(() => {
        inFlightRemoteSync = null;
    });

    return inFlightRemoteSync;
}

async function runRemotePolicySync(reason = "alarm") {
    const settings = await ensureRemoteSettings();

    if (!settings.enabled) {
        const skippedStatus = {
            ok: true,
            skipped: true,
            reason,
            lastSyncAt: new Date().toISOString(),
            message: "Remote sync disabled"
        };
        await storageSet({ remoteSyncStatus: skippedStatus });
        return skippedStatus;
    }

    try {
        const cachedResult = await storageGet(["parentPolicy"]);
        await registerDevice(settings, cachedResult.parentPolicy || null);

        const response = await fetch(buildDeviceUrl(settings, "/policy"), {
            cache: "no-store",
            headers: buildRemoteHeaders(settings, {
                "Accept": "application/json"
            })
        });

        if (!response.ok) {
            throw new Error(`Remote policy request failed with ${response.status}`);
        }

        const policy = sanitizePolicy(await response.json());
        const syncStatus = {
            ok: true,
            skipped: false,
            reason,
            lastSyncAt: new Date().toISOString(),
            policyUpdatedAt: policy.policyUpdatedAt,
            serverUrl: settings.serverUrl,
            deviceId: settings.deviceId
        };

        await storageSet({
            selectedPackage: policy.selectedPackage,
            customKeywords: policy.customKeywords,
            filterMode: policy.filterMode,
            parentPolicy: policy,
            remoteSyncStatus: syncStatus
        });

        await notifySupportedTabs();
        await acknowledgePolicy(settings, policy);
        return syncStatus;
    } catch (error) {
        const syncStatus = {
            ok: false,
            skipped: false,
            reason,
            lastSyncAt: new Date().toISOString(),
            error: error.message || String(error),
            serverUrl: settings.serverUrl,
            deviceId: settings.deviceId
        };
        await storageSet({ remoteSyncStatus: syncStatus });
        return syncStatus;
    }
}

function scheduleRemoteSyncAlarm(settings = DEFAULT_REMOTE_SETTINGS) {
    if (!chrome.alarms?.create) {
        return;
    }

    chrome.alarms.create(REMOTE_SYNC_ALARM, {
        periodInMinutes: Math.max(0.5, Number(settings.pollIntervalMinutes) || DEFAULT_REMOTE_SETTINGS.pollIntervalMinutes)
    });
}

async function uploadStats(stats) {
    const settings = await ensureRemoteSettings();
    if (!settings.enabled || !stats) {
        return;
    }

    try {
        await fetch(buildDeviceUrl(settings, "/stats"), {
            method: "POST",
            headers: buildRemoteHeaders(settings, {
                "Content-Type": "application/json"
            }),
            body: JSON.stringify({
                ...stats,
                uploadedAt: new Date().toISOString()
            })
        });
    } catch (error) {
        await storageSet({
            remoteStatsStatus: {
                ok: false,
                lastUploadAt: new Date().toISOString(),
                error: error.message || String(error)
            }
        });
    }
}

chrome.runtime.onInstalled.addListener(async () => {
    const settings = await ensureRemoteSettings();
    scheduleRemoteSyncAlarm(settings);
    syncRemotePolicy("installed");
});

chrome.runtime.onStartup.addListener(async () => {
    const settings = await ensureRemoteSettings();
    scheduleRemoteSyncAlarm(settings);
    syncRemotePolicy("startup");
});

chrome.alarms?.onAlarm.addListener(alarm => {
    if (alarm.name === REMOTE_SYNC_ALARM) {
        syncRemotePolicy("alarm");
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SET_ALGORITHM_ACTIVE_SYNC") {
        syncRemotePolicy("active-tab").then(status => sendResponse({ ok: true, status }));
        return true;
    }

    if (message?.type === "SET_ALGORITHM_REMOTE_SYNC_NOW") {
        syncRemotePolicy("manual").then(status => sendResponse({ ok: true, status }));
        return true;
    }

    if (message?.type === "SET_ALGORITHM_REMOTE_SETTINGS") {
        ensureRemoteSettings()
            .then(currentSettings => {
                const nextSettings = normalizeRemoteSettings({
                    ...currentSettings,
                    ...(message.settings || {})
                });
                return storageSet({ remoteSettings: nextSettings }).then(() => nextSettings);
            })
            .then(nextSettings => {
                scheduleRemoteSyncAlarm(nextSettings);
                return syncRemotePolicy("settings-updated");
            })
            .then(status => sendResponse({ ok: true, status }))
            .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
    }

    return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
        enforceParentPolicy(changes).catch(error => {
            console.warn("Parent policy enforcement failed:", error);
        });
    }

    if (areaName === "local" && changes.filterStats?.newValue) {
        uploadStats(changes.filterStats.newValue);
    }
});

ensureRemoteSettings().then(settings => {
    scheduleRemoteSyncAlarm(settings);
    syncRemotePolicy("service-worker-start");
});
