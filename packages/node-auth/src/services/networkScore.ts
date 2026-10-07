import type { NetworkFlags, NetworkResult } from "@securekit/core";
import type { IpCheckOutput } from "./ipCheck";

function normalizeCountryCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function toFlag(value: unknown): boolean {
  return value === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildFlags(ipCheck: IpCheckOutput): NetworkFlags {
  const security = (ipCheck.ip_info?.security ?? {}) as Record<string, unknown>;
  return {
    vpn: toFlag(security.vpn),
    proxy: toFlag(security.proxy),
    tor: toFlag(security.tor),
    relay: toFlag(security.relay),
    hosting: toFlag(security.hosting),
    mobile: toFlag(security.mobile),
    suspicious: toFlag(security.suspicious),
  };
}

function extractCountryCode(ipCheck: IpCheckOutput): string | null {
  const directCountry = normalizeCountryCode(ipCheck.ip_country_code);
  if (directCountry) return directCountry;

  const locationCountry = normalizeCountryCode(ipCheck.ip_info?.location?.country_code);
  if (locationCountry) return locationCountry;

  return null;
}

function extractTimezoneOffsetMin(ipCheck: IpCheckOutput): number | null {
  const offset = ipCheck.ip_info?.location?.utc_offset_minutes;
  return typeof offset === "number" ? offset : null;
}

function extractIp(ipCheck: IpCheckOutput, fallbackIp: string): string {
  const rawIp = ipCheck.ip_info?.ip;
  if (typeof rawIp === "string" && rawIp.trim()) return rawIp.trim();
  return fallbackIp;
}

export function computeNetworkResult(
  ipCheck: IpCheckOutput,
  clientOffsetMin?: number | null,
  fallbackIp = "unknown"
): NetworkResult {
  const flags = buildFlags(ipCheck);
  const timezoneOffsetMin = extractTimezoneOffsetMin(ipCheck);
  const driftMin =
    typeof timezoneOffsetMin === "number" && typeof clientOffsetMin === "number"
      ? Math.abs(clientOffsetMin - timezoneOffsetMin)
      : null;

  const reasons: string[] = [];
  let score = 1.0;

  if (typeof driftMin === "number") {
    if (driftMin > 360) {
      score -= 0.5;
      reasons.push("TIMEZONE_DRIFT_GT_6H");
    } else if (driftMin > 180) {
      score -= 0.3;
      reasons.push("TIMEZONE_DRIFT_GT_3H");
    } else if (driftMin > 60) {
      score -= 0.1;
      reasons.push("TIMEZONE_DRIFT_GT_1H");
    }
  }

  if (flags.vpn) {
    score -= 0.5;
    reasons.push("VPN_DETECTED");
  }
  if (flags.proxy) {
    score -= 0.3;
    reasons.push("PROXY_DETECTED");
  }
  if (flags.tor) {
    score -= 0.7;
    reasons.push("TOR_DETECTED");
  }
  if (flags.relay) {
    score -= 0.2;
    reasons.push("RELAY_DETECTED");
  }

  score = clamp(score, 0, 1);

  const result: NetworkResult = {
    ok: score >= 0.5,
    score,
    flags,
    reasons,
    ipInfo: {
      ip: extractIp(ipCheck, fallbackIp),
      countryCode: extractCountryCode(ipCheck),
      timezoneOffsetMin,
      clientOffsetMin: typeof clientOffsetMin === "number" ? clientOffsetMin : null,
      driftMin,
    },
  };

  if (ipCheck.ip_info) {
    result.raw = ipCheck.ip_info;
  }

  return result;
}
