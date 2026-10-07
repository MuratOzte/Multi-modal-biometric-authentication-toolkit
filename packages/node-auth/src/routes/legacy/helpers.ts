import type { Request } from "express";
import type { LocationResult, NetworkResult, VerifyError } from "@securekit/core";
import type { IpCheckOutput, RunIpCheckParams } from "../../services/ipCheck";
import { computeNetworkResult } from "../../services/networkScore";

export interface VpnClientMetadata {
  clientTimeZone: string | null;
  clientTimeOffsetMinutes: number | null;
}

export interface VerificationResult {
  ok: boolean;
  score: number;
  details?: unknown;
}

export interface VpnCheckResultDetails extends VpnClientMetadata {
  ip: string | null;
  ipTimeZone: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isRelay: boolean;
  timezoneDriftHours: number | null;
  source: string | null;
  ipInfo?: unknown;
}

export interface LocationCountryResultDetails {
  ip: string | null;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  matchesExpectedCountry: boolean | null;
  matchesClientCountry: boolean | null;
  reason: string | null;
  ipInfo?: unknown;
  security: {
    vpn: boolean | null;
    proxy: boolean | null;
    tor: boolean | null;
    relay: boolean | null;
  };
}

export interface LocationCountryResult extends VerificationResult {
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  details?: LocationCountryResultDetails;
}

export type RunIpCheckFn = (ip: string, params?: RunIpCheckParams) => Promise<IpCheckOutput>;

function normalizeCountryCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function readNumericValue(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

export function getClientIp(req: Request): string | null {
  const xfwd = req.headers["x-forwarded-for"];

  let ip: string | null = null;
  if (typeof xfwd === "string" && xfwd.length > 0) {
    ip = xfwd.split(",")[0]?.trim() || null;
  } else if (Array.isArray(xfwd) && xfwd.length > 0) {
    ip = xfwd[0] ?? null;
  } else {
    ip = req.socket.remoteAddress ?? null;
  }

  if (process.env.NODE_ENV !== "production") {
    if (ip === "::1" || ip === "127.0.0.1") {
      return "8.8.8.8";
    }
  }

  return ip;
}

export function parseClientOffsetMin(body: unknown): number | null {
  const source = (body ?? {}) as Record<string, unknown>;
  const candidates = [
    source.clientOffsetMin,
    source.clientTimeOffsetMinutes,
    source.clientTimezoneOffset,
    source.tzOffset,
    source.clientOffset,
  ];

  for (const candidate of candidates) {
    const value = readNumericValue(candidate);
    if (value !== null) return value;
  }

  return null;
}

export function parseVpnClientMetadata(req: Request): VpnClientMetadata {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clientTimeZone =
    typeof body.clientTimeZone === "string"
      ? body.clientTimeZone
      : typeof body.clientTimezone === "string"
        ? body.clientTimezone
        : null;

  return {
    clientTimeZone,
    clientTimeOffsetMinutes: parseClientOffsetMin(body),
  };
}

export function parseAllowedCountries(body: unknown): string[] | undefined {
  const input = (body ?? {}) as { allowedCountries?: unknown };
  if (!Array.isArray(input.allowedCountries)) return undefined;

  const normalized = input.allowedCountries
    .map((country) => normalizeCountryCode(country))
    .filter((country): country is string => Boolean(country));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
}

export function parseMockScenario(body: unknown): RunIpCheckParams["scenario"] | undefined {
  const source = (body ?? {}) as { scenario?: unknown };
  if (source.scenario === "clean" || source.scenario === "risky") {
    return source.scenario;
  }

  return undefined;
}

export function parseLegacyCountryInputs(body: unknown): {
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
} {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    expectedCountryCode: normalizeCountryCode(source.expectedCountryCode),
    clientCountryCode: normalizeCountryCode(source.clientCountryCode),
  };
}

function extractCountryCode(ipCheck: IpCheckOutput): string | null {
  const direct = normalizeCountryCode(ipCheck.ip_country_code);
  if (direct) return direct;

  return normalizeCountryCode(ipCheck.ip_info?.location?.country_code);
}

function extractIpTimeZone(ipCheck: IpCheckOutput): string | null {
  const timezone = ipCheck.ip_info?.location?.time_zone;
  return typeof timezone === "string" ? timezone : null;
}

function extractIpRegion(ipCheck: IpCheckOutput): string | null {
  const location = ipCheck.ip_info?.location;
  if (!location) return null;

  if (typeof location.region === "string") return location.region;
  if (typeof location.city === "string") return location.city;
  return null;
}

export function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

export async function resolveNetworkCheck(args: {
  ip: string;
  clientOffsetMin: number | null;
  scenario?: RunIpCheckParams["scenario"];
  runIpCheck: RunIpCheckFn;
}): Promise<{ ipCheck: IpCheckOutput; network: NetworkResult }> {
  const ipCheck = await args.runIpCheck(args.ip, {
    clientOffsetMin: args.clientOffsetMin,
    scenario: args.scenario,
  });

  const network = computeNetworkResult(ipCheck, args.clientOffsetMin, args.ip);
  return { ipCheck, network };
}

export function buildLocationResultFromIpCheck(args: {
  ipCheck: IpCheckOutput;
  allowedCountries?: string[];
}): LocationResult {
  const countryCode = extractCountryCode(args.ipCheck);
  const allowList = args.allowedCountries;
  const hasAllowList = Array.isArray(allowList) && allowList.length > 0;

  let allowed = true;
  const reasons: string[] = [];

  if (!countryCode) {
    reasons.push("COUNTRY_UNKNOWN");
  }

  if (hasAllowList) {
    if (!countryCode || !allowList.includes(countryCode)) {
      allowed = false;
      reasons.push("COUNTRY_NOT_ALLOWED");
    }
  }

  if (!hasAllowList && reasons.length === 1 && reasons[0] === "COUNTRY_UNKNOWN") {
    reasons.length = 0;
  }

  return {
    ok: allowed,
    countryCode,
    allowed,
    reasons,
  };
}

export function mapNetworkToLegacyVpnResult(args: {
  network: NetworkResult;
  ipCheck: IpCheckOutput;
  clientMeta: VpnClientMetadata;
}): VerificationResult & { details: VpnCheckResultDetails } {
  const timezoneDriftHours =
    typeof args.network.ipInfo.driftMin === "number" ? args.network.ipInfo.driftMin / 60 : null;

  const details: VpnCheckResultDetails = {
    ip: args.network.ipInfo.ip ?? null,
    ipTimeZone: extractIpTimeZone(args.ipCheck),
    ipCountry: args.network.ipInfo.countryCode ?? null,
    ipRegion: extractIpRegion(args.ipCheck),
    isVpn: args.network.flags.vpn === true,
    isProxy: args.network.flags.proxy === true,
    isTor: args.network.flags.tor === true,
    isRelay: args.network.flags.relay === true,
    timezoneDriftHours,
    clientTimeZone: args.clientMeta.clientTimeZone,
    clientTimeOffsetMinutes: args.clientMeta.clientTimeOffsetMinutes,
    source: "vpnapi.io+ip_check.py",
    ipInfo: args.ipCheck.ip_info ?? null,
  };

  return {
    ok: args.network.ok,
    score: args.network.score,
    details,
  };
}

export function mapLocationToLegacyResult(args: {
  ip: string;
  location: LocationResult;
  network: NetworkResult;
  ipCheck: IpCheckOutput;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
}): LocationCountryResult {
  const ipCountryCode = args.location.countryCode ?? null;
  const matchesExpectedCountry =
    args.expectedCountryCode && ipCountryCode ? ipCountryCode === args.expectedCountryCode : null;
  const matchesClientCountry =
    args.clientCountryCode && ipCountryCode ? ipCountryCode === args.clientCountryCode : null;

  let score = 0.7;
  let reason: string | null = "no_expected_country";

  if (args.expectedCountryCode) {
    if (matchesExpectedCountry === true) {
      score = 1.0;
      reason = "match_expected";
    } else if (matchesExpectedCountry === false) {
      score = 0.2;
      reason = "expected_country_mismatch";
    }
  } else if (matchesClientCountry !== null) {
    if (matchesClientCountry === true) {
      score = 1.0;
      reason = "match_client_country";
    } else {
      score = 0.2;
      reason = "client_country_mismatch";
    }
  }

  let penalty = 0;
  if (args.network.flags.vpn) penalty += 0.4;
  if (args.network.flags.proxy) penalty += 0.3;
  if (args.network.flags.tor) penalty += 0.5;
  if (args.network.flags.relay) penalty += 0.2;

  score = Math.max(0, Math.min(1, score - penalty));

  if (args.network.flags.vpn || args.network.flags.proxy || args.network.flags.tor || args.network.flags.relay) {
    if (reason === "match_expected" || reason === "match_client_country") {
      reason = "country_match_but_ip_security_risky";
    } else if (!reason || reason === "no_expected_country") {
      reason = "ip_security_risky";
    }
  }

  return {
    ok: score >= 0.5,
    score,
    ipCountryCode,
    expectedCountryCode: args.expectedCountryCode,
    clientCountryCode: args.clientCountryCode,
    details: {
      ip: args.ip,
      ipCountryCode,
      expectedCountryCode: args.expectedCountryCode,
      clientCountryCode: args.clientCountryCode,
      matchesExpectedCountry,
      matchesClientCountry,
      reason,
      ipInfo: args.ipCheck.ip_info ?? null,
      security: {
        vpn: args.network.flags.vpn === true,
        proxy: args.network.flags.proxy === true,
        tor: args.network.flags.tor === true,
        relay: args.network.flags.relay === true,
      },
    },
  };
}
