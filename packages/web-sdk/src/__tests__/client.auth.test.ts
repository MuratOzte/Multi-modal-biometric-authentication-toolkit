import { describe, expect, it, vi } from "vitest";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient auth methods", () => {
  it("register posts local credentials to /auth/register", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, userId: "emre", created: false })
    );
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.register({ userId: "emre", password: "emre" });

    expect(result).toEqual({ ok: true, userId: "emre", created: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/auth/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ userId: "emre", password: "emre" });
  });

  it("login posts local credentials to /auth/login", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, userId: "mert" }));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.login({ userId: "mert", password: "mert" });

    expect(result).toEqual({ ok: true, userId: "mert" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ userId: "mert", password: "mert" });
  });

  it("listUsers reads local user summaries from /auth/users", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, users: [{ userId: "emre" }] })
    );
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.listUsers();

    expect(result).toEqual({ ok: true, users: [{ userId: "emre" }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/auth/users");
    expect(init?.method ?? "GET").toBe("GET");
  });
});
