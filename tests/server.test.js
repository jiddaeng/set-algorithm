const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function request(baseUrl, requestPath, options = {}) {
  return fetch(`${baseUrl}${requestPath}`, options);
}

async function run() {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "set-algorithm-test-"));
  process.env.DATA_DIR = dataDirectory;
  process.env.FAMILY_KEY = "test-family-key";

  const { createServer } = require("../remote-server/server");
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const authenticatedHeaders = {
    "Content-Type": "application/json",
    "X-Family-Key": "test-family-key"
  };

  try {
    const healthResponse = await request(baseUrl, "/api/health");
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).authenticationRequired, true);

    const unauthorizedResponse = await request(baseUrl, "/api/devices");
    assert.equal(unauthorizedResponse.status, 401);

    const cachedPolicy = {
      selectedPackage: "study",
      filterMode: "allowlist",
      customKeywords: {
        study: {
          include: ["수학"],
          exclude: ["게임"]
        }
      },
      revision: 7,
      policyUpdatedAt: "2026-07-22T00:00:00.000Z"
    };
    const registerResponse = await request(baseUrl, "/api/devices/kid-test123/register", {
      method: "POST",
      headers: authenticatedHeaders,
      body: JSON.stringify({ cachedPolicy })
    });
    assert.equal(registerResponse.status, 200);

    const policyResponse = await request(baseUrl, "/api/devices/kid-test123/policy", {
      headers: authenticatedHeaders
    });
    assert.equal(policyResponse.status, 200);
    const policy = await policyResponse.json();
    assert.equal(policy.selectedPackage, "study");
    assert.equal(policy.filterMode, "allowlist");
    assert.equal(policy.revision, 7);
    assert.deepEqual(policy.customKeywords.study, {
      include: ["수학"],
      exclude: ["게임"]
    });

    console.log("server tests passed");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
