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
  process.env.DEVICE_KEY = "test-device-key";

  const { createServer } = require("../remote-server/server");
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const familyHeaders = {
    "Content-Type": "application/json",
    "X-Family-Key": "test-family-key"
  };
  const deviceHeaders = {
    "Content-Type": "application/json",
    "X-Device-Key": "test-device-key"
  };

  try {
    const packagesResponse = await request(baseUrl, "/shared/packages.js");
    assert.equal(packagesResponse.status, 200);
    assert.match(packagesResponse.headers.get("content-type"), /javascript/);
    assert.match(await packagesResponse.text(), /const PACKAGE_CONFIG/);

    const healthResponse = await request(baseUrl, "/api/health");
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.authenticationRequired, true);
    assert.equal(health.deviceAuthenticationRequired, true);

    const unauthorizedResponse = await request(baseUrl, "/api/devices");
    assert.equal(unauthorizedResponse.status, 401);

    const deviceListResponse = await request(baseUrl, "/api/devices", {
      headers: deviceHeaders
    });
    assert.equal(deviceListResponse.status, 401);

    const firstRegisterResponse = await request(baseUrl, "/api/devices/kid-test123/register", {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({})
    });
    assert.equal(firstRegisterResponse.status, 200);
    const firstPolicy = (await firstRegisterResponse.json()).policy;
    assert.ok(firstPolicy.policySignature);

    const childWriteResponse = await request(baseUrl, "/api/devices/kid-test123/policy", {
      method: "PUT",
      headers: deviceHeaders,
      body: JSON.stringify({
        ...firstPolicy,
        selectedPackage: "workout",
        baseRevision: 1
      })
    });
    assert.equal(childWriteResponse.status, 401);

    const parentPolicyPatch = {
      selectedPackage: "study",
      filterMode: "allowlist",
      customKeywords: {
        study: {
          include: ["수학"],
          exclude: ["게임"]
        }
      },
      baseRevision: 1
    };
    const parentWriteResponse = await request(baseUrl, "/api/devices/kid-test123/policy", {
      method: "PUT",
      headers: familyHeaders,
      body: JSON.stringify(parentPolicyPatch)
    });
    assert.equal(parentWriteResponse.status, 200);
    const signedParentPolicy = await parentWriteResponse.json();
    assert.equal(signedParentPolicy.revision, 2);
    assert.ok(signedParentPolicy.policySignature);

    await fs.rm(path.join(dataDirectory, "policies.json"), { force: true });
    const recoveryResponse = await request(baseUrl, "/api/devices/kid-test123/register", {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({ cachedPolicy: signedParentPolicy })
    });
    assert.equal(recoveryResponse.status, 200);

    const policyResponse = await request(baseUrl, "/api/devices/kid-test123/policy", {
      headers: deviceHeaders
    });
    assert.equal(policyResponse.status, 200);
    const policy = await policyResponse.json();
    assert.equal(policy.selectedPackage, "study");
    assert.equal(policy.filterMode, "allowlist");
    assert.equal(policy.revision, 2);
    assert.deepEqual(policy.customKeywords.study, {
      include: ["수학"],
      exclude: ["게임"]
    });

    await fs.rm(path.join(dataDirectory, "policies.json"), { force: true });
    const tamperedRecoveryResponse = await request(baseUrl, "/api/devices/kid-test123/register", {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        cachedPolicy: {
          ...signedParentPolicy,
          selectedPackage: "workout"
        }
      })
    });
    assert.equal(tamperedRecoveryResponse.status, 200);
    const tamperedResult = (await tamperedRecoveryResponse.json()).policy;
    assert.equal(tamperedResult.selectedPackage, "kids");

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
