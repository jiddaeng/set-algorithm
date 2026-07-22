const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.classList = { toggle() {} };
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  focus() {}
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function findElements(root, predicate) {
  const matches = predicate(root) ? [root] : [];
  return matches.concat(root.children.flatMap(child => findElements(child, predicate)));
}

async function flushPromises() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function run() {
  const ids = [
    "serverStatus", "authPanel", "familyKeyInput", "connectFamilyButton",
    "deviceIdInput", "loadDeviceButton", "refreshDevicesButton", "deviceList",
    "policyMeta", "statsBox", "savePolicyButton", "packageSelect",
    "filterModeSelect", "includeKeywordInput", "excludeKeywordInput",
    "addIncludeButton", "addExcludeButton", "includeKeywordList", "excludeKeywordList"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  const protectedContent = [new FakeElement(), new FakeElement()];
  const localValues = new Map([["setAlgorithmFamilyKey", "family-key"]]);
  const intervalCallbacks = [];
  const serverPolicy = {
    deviceId: "kid-test123",
    selectedPackage: "kids",
    filterMode: "blocklist",
    customKeywords: { kids: { include: ["맞춤 키워드"], exclude: ["폭력"] } },
    revision: 1,
    updatedAt: "2026-07-22T00:00:00.000Z",
    lastSeenAt: "2026-07-22T00:00:00.000Z"
  };

  const context = {
    console,
    URLSearchParams,
    window: {
      location: { search: "" },
      PACKAGE_CONFIG: {
        kids: {
          label: "Kids Safe Pack",
          include: ["kids", "교육"],
          exclude: ["폭력"]
        },
        study: {
          label: "Study Pack",
          include: ["study", "공부"],
          exclude: ["game"]
        }
      }
    },
    localStorage: {
      getItem: key => localValues.get(key) || null,
      setItem: (key, value) => localValues.set(key, String(value))
    },
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector === ".protected-content" ? protectedContent : [],
      createElement: () => new FakeElement()
    },
    fetch: async requestPath => {
      if (requestPath === "/api/health") {
        return jsonResponse({ ok: true, configured: true, authenticationRequired: true });
      }
      if (requestPath === "/api/devices") {
        return jsonResponse({ devices: [{ deviceId: serverPolicy.deviceId, lastSeenAt: serverPolicy.lastSeenAt }] });
      }
      if (requestPath.endsWith("/policy")) {
        return jsonResponse({ ...serverPolicy });
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    },
    setInterval: callback => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    setTimeout
  };
  vm.createContext(context);
  const script = fs.readFileSync(
    path.join(__dirname, "../remote-server/public/app.js"),
    "utf8"
  );
  vm.runInContext(script, context);
  await flushPromises();

  assert.equal(elements.packageSelect.value, "kids");
  const baseChips = findElements(elements.includeKeywordList, element => element.className.includes("chip include base"));
  const customChips = findElements(elements.includeKeywordList, element => element.className === "chip include");
  assert.equal(baseChips.length, 2);
  assert.equal(customChips.length, 1);
  assert.equal(findElements(baseChips[0], element => element.dataset.keyword).length, 0);
  assert.equal(findElements(customChips[0], element => element.dataset.keyword === "맞춤 키워드").length, 1);

  elements.packageSelect.value = "study";
  elements.packageSelect.listeners.change();
  assert.equal(elements.savePolicyButton.textContent, "정책 저장 · 변경됨");

  intervalCallbacks[0]();
  await flushPromises();

  assert.equal(elements.packageSelect.value, "study");
  assert.equal(elements.savePolicyButton.textContent, "정책 저장 · 변경됨");
  assert.equal(elements.serverStatus.textContent, "저장되지 않은 변경사항이 있습니다.");
  console.log("dashboard tests passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
