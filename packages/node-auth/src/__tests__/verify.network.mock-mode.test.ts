import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server";

const originalMockIpCheck = process.env.MOCK_IP_CHECK;
const originalPythonCmd = process.env.PYTHON_CMD;

afterEach(() => {
  if (originalMockIpCheck === undefined) {
    delete process.env.MOCK_IP_CHECK;
  } else {
    process.env.MOCK_IP_CHECK = originalMockIpCheck;
  }

  if (originalPythonCmd === undefined) {
    delete process.env.PYTHON_CMD;
  } else {
    process.env.PYTHON_CMD = originalPythonCmd;
  }
});

describe("verify network mock mode", () => {
  it("uses mock fixture when MOCK_IP_CHECK=1 and does not require python", async () => {
    process.env.MOCK_IP_CHECK = "1";
    process.env.PYTHON_CMD = "definitely_not_installed_python_binary";

    const app = createApp();
    const response = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "10.10.10.10")
      .send({
        clientOffsetMin: 180,
        scenario: "clean",
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.flags).toMatchObject({
      vpn: false,
      proxy: false,
      tor: false,
      relay: false,
    });
    expect(response.body.ipInfo.countryCode).toBe("TR");
  });

  it("accepts risky scenario in mock mode", async () => {
    process.env.MOCK_IP_CHECK = "1";
    process.env.PYTHON_CMD = "definitely_not_installed_python_binary";

    const app = createApp();
    const response = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "10.10.10.10")
      .send({
        clientOffsetMin: 180,
        scenario: "risky",
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.flags).toMatchObject({
      vpn: true,
      proxy: true,
      tor: true,
      relay: true,
    });
    expect(response.body.ipInfo.countryCode).toBe("RU");
  });
});
