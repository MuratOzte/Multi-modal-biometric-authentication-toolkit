import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server";
import type { IpCheckOutput } from "../services/ipCheck";

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

function createMockedApp() {
  return createApp({
    runIpCheck: vi.fn(async () => fixtureClean),
  });
}

describe("verify location endpoints", () => {
  it("POST /verify/location allows matching country", async () => {
    const app = createMockedApp();

    const response = await request(app)
      .post("/verify/location")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ allowedCountries: ["TR", "US"] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      countryCode: "TR",
      allowed: true,
    });
  });

  it("POST /verify/location denies disallowed country", async () => {
    const app = createMockedApp();

    const response = await request(app)
      .post("/verify/location")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ allowedCountries: ["US", "DE"] });

    expect(response.status).toBe(200);
    expect(response.body.allowed).toBe(false);
    expect(response.body.reasons).toContain("COUNTRY_NOT_ALLOWED");
  });

  it("POST /verify/location:country keeps legacy schema and same allowed/country meaning", async () => {
    const app = createMockedApp();

    const standard = await request(app)
      .post("/verify/location")
      .set("x-forwarded-for", "1.2.3.4")
      .send({ allowedCountries: ["US"] });

    const alias = await request(app)
      .post("/verify/location:country")
      .set("x-forwarded-for", "1.2.3.4")
      .send({
        expectedCountryCode: "US",
        clientCountryCode: "US",
      });

    expect(alias.status).toBe(200);
    expect(alias.body).toMatchObject({
      ok: false,
      ipCountryCode: "TR",
      expectedCountryCode: "US",
      clientCountryCode: "US",
      details: {
        ip: "1.2.3.4",
        ipCountryCode: "TR",
        expectedCountryCode: "US",
        clientCountryCode: "US",
        matchesExpectedCountry: false,
        matchesClientCountry: false,
        security: {
          vpn: false,
          proxy: false,
          tor: false,
          relay: false,
        },
      },
    });

    expect(standard.body).toMatchObject({
      countryCode: "TR",
      allowed: false,
    });
  });
});
