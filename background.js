const REMOTE_SYNC_ALARM = "setAlgorithmRemoteSync";
const DEFAULT_REMOTE_SETTINGS = {
    enabled: true,
    serverUrl: "http://localhost:3000",
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
    const value = String(serverUrl || DEFAULT_REMOTE_SETTINGS.serverUrl).trim();
    return value.replace(/\/+$/, "") || DEFAULT_REMOTE_SETTINGS.serverUrl;
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

async function registerDevice(settings) {
    await fetch(buildDeviceUrl(settings, "/register"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            extensionVersion: chrome.runtime.getManifest().version,
            userAgent: navigator.userAgent,
            registeredAt: new Date().toISOString()
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
        policyUpdatedAt: policy?.updatedAt || ""
    };
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

async function syncRemotePolicy(reason = "alarm") {
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
        await registerDevice(settings);

        const response = await fetch(buildDeviceUrl(settings, "/policy"), {
            cache: "no-store",
            headers: {
                "Accept": "application/json"
            }
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
            remoteSyncStatus: syncStatus
        });

        await notifySupportedTabs();
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
            headers: {
                "Content-Type": "application/json"
            },
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
    if (areaName === "local" && changes.filterStats?.newValue) {
        uploadStats(changes.filterStats.newValue);
    }
});

ensureRemoteSettings().then(settings => {
    scheduleRemoteSyncAlarm(settings);
    syncRemotePolicy("service-worker-start");
});
