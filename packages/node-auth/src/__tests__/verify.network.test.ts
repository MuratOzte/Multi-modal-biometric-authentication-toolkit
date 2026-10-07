import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server";
import type { IpCheckOutput } from "../services/ipCheck";

/**
 * Manual curl samples:
 * curl -X POST http://localhost:3001/verify/network -H "Content-Type: application/json" -d "{\"clientOffsetMin\":180}"
 * curl -X POST http://localhost:3001/verify/location -H "Content-Type: application/json" -d "{\"allowedCountries\":[\"TR\",\"US\"]}"
 */

const fixtureClean: IpCheckOutput = {
  ip_country_code: "TR",
  ip_info: {
    ip: "1.2.3.4",
    security: {
      vpn: false,
      proxy: false,
      tor: false,
      relay: false,
    },
    location: {
      country_code: "TR",
      time_zone: "Europe/Istanbul",
      utc_offset_minutes: 180,
      region: "Istanbul",
      city: "Istanbul",
    },
  },
};

const fixtureRisky: IpCheckOutput = {
  ip_country_code: "RU",
  ip_info: {
    ip: "5.6.7.8",
    security: {
      vpn: true,
      proxy: false,
      tor: true,
      relay: true,
    },
    location: {
      country_code: "RU",
      time_zone: "UTC",
      utc_offset_minutes: 0,
      region: "Moscow",
      city: "Moscow",
    },
  },
};

function createMockedApp() {
  const runIpCheck = vi.fn(async (ip: string) => {
    if (ip === "1.2.3.4") return fixtureClean;
    if (ip === "5.6.7.8") return fixtureRisky;
    throw new Error(`Unknown fixture IP: ${ip}`);
  });

  return {
    app: createApp({ runIpCheck }),
    runIpCheck,
  };
}

describe("verify network endpoints", () => {
  it("POST /verify/network returns NetworkResult for clean fixture", async () => {
    const { app } = createMockedApp();

    const response = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ clientOffsetMin: 180 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.score).toBe("number");
    expect(response.body.flags).toMatchObject({
      vpn: false,
      proxy: false,
      tor: false,
      relay: false,
    });
    expect(response.body.ipInfo.countryCode).toBe("TR");
    expect(response.body.ipInfo.driftMin).toBe(0);
  });

  it("POST /verify/network produces low score and reasons for risky fixture", async () => {
    const { app } = createMockedApp();

    const response = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "5.6.7.8")
      .send({ clientOffsetMin: 180 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.score).toBeLessThan(1);
    expect(response.body.reasons).toEqual(
      expect.arrayContaining([
        "VPN_DETECTED",
        "TOR_DETECTED",
        "RELAY_DETECTED",
        "TIMEZONE_DRIFT_GT_1H",
      ])
    );
  });

  it("POST /verify/vpn:check keeps legacy schema and matches new network meaning", async () => {
    const { app } = createMockedApp();

    const network = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ clientOffsetMin: 180 });

    const alias = await request(app)
      .post("/verify/vpn:check")
      .set("x-forwarded-for", "1.2.3.4")
      .send({
        clientTimeZone: "Europe/Istanbul",
        clientTimeOffsetMinutes: 180,
      });

    expect(alias.status).toBe(200);
    expect(alias.body).toMatchObject({
      ok: true,
      score: network.body.score,
      details: {
        ip: "1.2.3.4",
        ipCountry: "TR",
        isVpn: false,
        isProxy: false,
        isTor: false,
        isRelay: false,
        clientTimeZone: "Europe/Istanbul",
        clientTimeOffsetMinutes: 180,
      },
    });
    expect(alias.body.details).toHaveProperty("timezoneDriftHours", 0);
  });

  it("returns standardized error response when ip check fails", async () => {
    const app = createApp({
      runIpCheck: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    const response = await request(app)
      .post("/verify/network")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ clientOffsetMin: 180 });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      error: {
        code: "IP_CHECK_FAILED",
      },
    });
  });
});
