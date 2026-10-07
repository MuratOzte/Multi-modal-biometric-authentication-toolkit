import { describe, expect, it, vi } from "vitest";
import type { LocationResult, NetworkResult } from "@securekit/core";
import { SecureKitClient } from "../index";

const networkFixture: NetworkResult = {
  ok: true,
  score: 0.92,
  flags: {
    vpn: false,
    proxy: false,
    tor: false,
    relay: false,
  },
  reasons: [],
  ipInfo: {
    ip: "1.2.3.4",
    countryCode: "TR",
    timezoneOffsetMin: 180,
    clientOffsetMin: 180,
    driftMin: 0,
  },
};

const locationFixture: LocationResult = {
  ok: true,
  countryCode: "TR",
  allowed: true,
  reasons: [],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient verify methods", () => {
  it("verifyNetwork posts to /verify/network with expected body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(networkFixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.verifyNetwork({ clientOffsetMin: 180 });

    expect(result).toEqual(networkFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/verify/network",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clientOffsetMin: 180 }),
      })
    );
  });

  it("verifyLocation posts to /verify/location with expected body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(locationFixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.verifyLocation({ allowedCountries: ["TR", "US"] });

    expect(result).toEqual(locationFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/verify/location",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ allowedCountries: ["TR", "US"] }),
      })
    );
  });

  it("legacy methods delegate to new verify methods", async () => {
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    const verifyNetworkSpy = vi
      .spyOn(client, "verifyNetwork")
      .mockResolvedValue(networkFixture);

    await client.verifyVpn();

    expect(verifyNetworkSpy).toHaveBeenCalled();

    const verifyLocationSpy = vi
      .spyOn(client, "verifyLocation")
      .mockResolvedValue(locationFixture);

    verifyNetworkSpy.mockResolvedValue(networkFixture);

    await client.verifyLocationCountry("TR");

    expect(verifyLocationSpy).toHaveBeenCalledWith({ allowedCountries: ["TR"] });
    expect(verifyNetworkSpy).toHaveBeenCalled();
  });
});
