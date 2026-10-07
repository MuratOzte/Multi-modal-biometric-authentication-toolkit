import {
  HttpError,
  SecureKitClient,
  type LocationResult,
  type NetworkResult,
  type VpnPolicyConfig,
  type VpnVerificationWithDecision,
} from "@securekit/web-sdk";

const DEFAULT_BASE_URL = "/api/securekit";

const defaultVpnPolicy: VpnPolicyConfig = {
  allowVpn: true,
  allowProxy: true,
  allowTor: false,
  allowRelay: true,
  minScore: 0.5,
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function toFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function resolveFallbackUrl(url: string): string | null {
  const normalized = url.trim();
  if (normalized.startsWith("/api/securekit/keystroke/")) {
    return `http://127.0.0.1:3001${normalized}`;
  }

  if (normalized.startsWith("/api/securekit")) {
    const suffix = normalized.slice("/api/securekit".length);
    return `http://127.0.0.1:3001${suffix}`;
  }

  if (normalized.startsWith("http://localhost:3001")) {
    return normalized.replace("http://localhost:3001", "http://127.0.0.1:3001");
  }

  if (normalized.startsWith("http://127.0.0.1:3001")) {
    return normalized.replace("http://127.0.0.1:3001", "http://localhost:3001");
  }

  return null;
}

async function fetchWithFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const primaryUrl = toFetchUrl(input);
  const fallbackUrl = resolveFallbackUrl(primaryUrl);

  try {
    const primaryResponse = await fetch(input, init);
    if (primaryResponse.status !== 404 || !fallbackUrl) {
      return primaryResponse;
    }

    return fetch(fallbackUrl, init);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    if (!fallbackUrl) {
      throw error;
    }

    return fetch(fallbackUrl, init);
  }
}

function shouldUseProxyFallbackInBrowser(baseUrl: string): boolean {
  if (typeof window === "undefined") return false;

  const normalized = normalizeBaseUrl(baseUrl);
  const isHttpTarget = /^http:\/\//i.test(normalized);
  const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized);
  const isLocalPage = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (isHttpTarget && window.location.protocol === "https:") {
    return true;
  }

  if (isLocalTarget && !isLocalPage) {
    return true;
  }

  return false;
}

export function resolveSecureKitBaseUrl(): string {
  const raw = import.meta.env.VITE_SECUREKIT_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const normalized = normalizeBaseUrl(raw.trim());
    if (shouldUseProxyFallbackInBrowser(normalized)) {
      return DEFAULT_BASE_URL;
    }

    return normalized;
  }

  return DEFAULT_BASE_URL;
}

export function createSecureKitClient(baseUrl = resolveSecureKitBaseUrl()): SecureKitClient {
  return new SecureKitClient({
    baseUrl: normalizeBaseUrl(baseUrl),
    vpnPolicy: defaultVpnPolicy,
    fetchImpl: (input, init) => fetchWithFallback(input, init),
  });
}

let cachedClient: SecureKitClient | null = null;
let cachedBaseUrl: string | null = null;

export function getSecureKitClient(): SecureKitClient {
  const baseUrl = resolveSecureKitBaseUrl();
  if (!cachedClient || cachedBaseUrl !== baseUrl) {
    cachedClient = createSecureKitClient(baseUrl);
    cachedBaseUrl = baseUrl;
  }

  return cachedClient;
}

export const secureKitClient = getSecureKitClient();

export type LocationCheckWithDecision = {
  raw: LocationResult;
  network: NetworkResult;
  decision: {
    allowed: boolean;
    reason: string;
    effectiveScore: number;
  };
};

function buildUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text;
}

export async function postSecureKitJson<T>(
  path: string,
  body?: unknown,
  baseUrl = resolveSecureKitBaseUrl()
): Promise<T> {
  const response = await fetchWithFallback(buildUrl(baseUrl, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
    throw new HttpError(response.status, message, payload);
  }

  return payload as T;
}

export async function getSecureKitJson<T>(
  path: string,
  baseUrl = resolveSecureKitBaseUrl()
): Promise<T> {
  const response = await fetchWithFallback(buildUrl(baseUrl, path), {
    method: "GET",
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
    throw new HttpError(response.status, message, payload);
  }

  return payload as T;
}

export async function deleteSecureKitJson<T>(
  path: string,
  body?: unknown,
  baseUrl = resolveSecureKitBaseUrl()
): Promise<T> {
  const response = await fetchWithFallback(buildUrl(baseUrl, path), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
    throw new HttpError(response.status, message, payload);
  }

  return payload as T;
}

function extractServerErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const root = body as {
    message?: unknown;
    error?: { message?: unknown };
  };

  if (typeof root.message === "string" && root.message.trim().length > 0) {
    return root.message;
  }

  if (typeof root.error?.message === "string" && root.error.message.trim().length > 0) {
    return root.error.message;
  }

  return null;
}

export function formatSecureKitError(
  error: unknown,
  baseUrl = resolveSecureKitBaseUrl()
): string {
  if (error instanceof HttpError) {
    const serverMessage = extractServerErrorMessage(error.body);
    return `Request failed (HTTP ${error.status}) at ${baseUrl}${serverMessage ? `: ${serverMessage}` : "."}`;
  }

  if (error instanceof TypeError) {
    return `Could not reach SecureKit at ${baseUrl}. Check VITE_SECUREKIT_BASE_URL and backend status.`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function checkLocationCountryAuto(): Promise<LocationResult> {
  return getSecureKitClient().verifyLocation();
}

export async function checkLocationCountryManual(
  expectedCountryCode: string
): Promise<LocationResult> {
  return getSecureKitClient().verifyLocation({
    allowedCountries: [expectedCountryCode],
  });
}

export async function checkLocationCountryWithPolicy(
  expectedCountryCode?: string
): Promise<LocationCheckWithDecision> {
  const allowedCountries = expectedCountryCode ? [expectedCountryCode] : undefined;
  const client = getSecureKitClient();

  const [raw, network] = await Promise.all([
    client.verifyLocation({ allowedCountries }),
    client.verifyNetwork(),
  ]);

  return {
    raw,
    network,
    decision: {
      allowed: raw.allowed && network.ok,
      reason: raw.reasons[0] ?? network.reasons[0] ?? "ok",
      effectiveScore: network.score,
    },
  };
}

export async function checkVpnRaw(): Promise<NetworkResult> {
  return getSecureKitClient().verifyNetwork();
}

export async function checkVpnWithPolicy(
  policyOverride?: VpnPolicyConfig
): Promise<VpnVerificationWithDecision> {
  return getSecureKitClient().verifyVpnWithPolicy(policyOverride);
}
