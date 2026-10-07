import type { NetworkResult, LocationResult } from "@securekit/core";
import type {
  BuildLegacyVpnResultArgs,
  BuildLocationCountryResultArgs,
  LocationCountryResult,
  LocationPolicyConfig,
  PolicyDecision,
  VerificationResult,
  VpnCheckDetails,
  VpnPolicyConfig,
} from "./client.types";

export function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function getLocationFromRaw(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const candidate = (raw as { location?: unknown }).location;
  if (!candidate || typeof candidate !== "object") return {};
  return candidate as Record<string, unknown>;
}

function computeLegacyLocationScore(args: {
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  network: NetworkResult;
}): { score: number; reason: string | null } {
  const { ipCountryCode, expectedCountryCode, clientCountryCode, network } = args;

  const matchesExpectedCountry =
    expectedCountryCode && ipCountryCode ? ipCountryCode === expectedCountryCode : null;
  const matchesClientCountry =
    clientCountryCode && ipCountryCode ? ipCountryCode === clientCountryCode : null;

  let score = 0.7;
  let reason: string | null = "no_expected_country";

  if (expectedCountryCode) {
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
  if (network.flags.vpn) penalty += 0.4;
  if (network.flags.proxy) penalty += 0.3;
  if (network.flags.tor) penalty += 0.5;
  if (network.flags.relay) penalty += 0.2;

  score = Math.max(0, Math.min(1, score - penalty));

  if (network.flags.vpn || network.flags.proxy || network.flags.tor || network.flags.relay) {
    if (reason === "match_expected" || reason === "match_client_country") {
      reason = "country_match_but_ip_security_risky";
    } else if (!reason || reason === "no_expected_country") {
      reason = "ip_security_risky";
    }
  }

  return { score, reason };
}

export function buildLegacyVpnResult(
  args: BuildLegacyVpnResultArgs
): VerificationResult & { details?: VpnCheckDetails } {
  const location = getLocationFromRaw(args.network.raw);

  return {
    ok: args.network.ok,
    score: args.network.score,
    details: {
      ip: args.network.ipInfo.ip ?? null,
      ipTimeZone: typeof location.time_zone === "string" ? (location.time_zone as string) : null,
      ipCountry: args.network.ipInfo.countryCode ?? null,
      ipRegion:
        typeof location.region === "string"
          ? (location.region as string)
          : typeof location.city === "string"
            ? (location.city as string)
            : null,
      isVpn: args.network.flags.vpn === true,
      isProxy: args.network.flags.proxy === true,
      isTor: args.network.flags.tor === true,
      isRelay: args.network.flags.relay === true,
      timezoneDriftHours:
        typeof args.network.ipInfo.driftMin === "number" ? args.network.ipInfo.driftMin / 60 : null,
      clientTimeZone: args.clientTimeZone,
      clientTimeOffsetMinutes: args.clientTimeOffsetMinutes,
      source: "vpnapi.io+ip_check.py",
      ipInfo: args.network.raw ?? null,
    },
  };
}

export function buildLocationCountryResult(
  args: BuildLocationCountryResultArgs
): LocationCountryResult {
  const normalizedExpected = normalizeCountryCode(args.expectedCountryCode);
  const normalizedClient = normalizeCountryCode(args.clientCountryCode);
  const ipCountryCode = normalizeCountryCode(args.location.countryCode ?? null);
  const matchesExpectedCountry =
    normalizedExpected && ipCountryCode ? ipCountryCode === normalizedExpected : null;
  const matchesClientCountry =
    normalizedClient && ipCountryCode ? ipCountryCode === normalizedClient : null;

  const { score, reason } = computeLegacyLocationScore({
    ipCountryCode,
    expectedCountryCode: normalizedExpected,
    clientCountryCode: normalizedClient,
    network: args.network,
  });

  return {
    ok: score >= 0.5,
    score,
    ipCountryCode,
    expectedCountryCode: normalizedExpected,
    clientCountryCode: normalizedClient,
    details: {
      ip: args.network.ipInfo.ip ?? null,
      ipCountryCode,
      expectedCountryCode: normalizedExpected,
      clientCountryCode: normalizedClient,
      matchesExpectedCountry,
      matchesClientCountry,
      reason,
      ipInfo: args.network.raw ?? null,
      security: {
        vpn: args.network.flags.vpn === true,
        proxy: args.network.flags.proxy === true,
        tor: args.network.flags.tor === true,
        relay: args.network.flags.relay === true,
      },
    },
  };
}

export function evaluateVpnPolicy(
  result: VerificationResult & { details?: VpnCheckDetails },
  policy?: VpnPolicyConfig
): PolicyDecision {
  const minScore = policy?.minScore ?? 0.5;
  const details = result.details;

  const isVpn = details?.isVpn === true;
  const isProxy = details?.isProxy === true;
  const isTor = details?.isTor === true;
  const isRelay = details?.isRelay === true;

  if (policy) {
    if (policy.allowVpn === false && isVpn) {
      return {
        allowed: false,
        reason: "vpn_not_allowed",
        effectiveScore: result.score,
      };
    }
    if (policy.allowProxy === false && isProxy) {
      return {
        allowed: false,
        reason: "proxy_not_allowed",
        effectiveScore: result.score,
      };
    }
    if (policy.allowTor === false && isTor) {
      return {
        allowed: false,
        reason: "tor_not_allowed",
        effectiveScore: result.score,
      };
    }
    if (policy.allowRelay === false && isRelay) {
      return {
        allowed: false,
        reason: "relay_not_allowed",
        effectiveScore: result.score,
      };
    }
  }

  if (result.score < minScore) {
    return {
      allowed: false,
      reason: "score_below_min",
      effectiveScore: result.score,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    effectiveScore: result.score,
  };
}

export function evaluateLocationPolicy(
  result: LocationCountryResult,
  policy?: LocationPolicyConfig
): PolicyDecision {
  const minScore = policy?.minScore ?? 0.5;
  const details = result.details;

  const ipCountry = normalizeCountryCode(result.ipCountryCode);
  const expected = normalizeCountryCode(
    result.expectedCountryCode ?? details?.expectedCountryCode ?? undefined
  );
  const client = normalizeCountryCode(
    result.clientCountryCode ?? details?.clientCountryCode ?? undefined
  );

  if (policy?.requireCountryMatch) {
    if (expected && ipCountry && ipCountry !== expected) {
      return {
        allowed: false,
        reason: "ip_country_mismatch_expected",
        effectiveScore: result.score,
      };
    }
    if (!expected && client && ipCountry && ipCountry !== client) {
      return {
        allowed: false,
        reason: "ip_country_mismatch_client",
        effectiveScore: result.score,
      };
    }
  }

  if (policy?.allowedCountries && ipCountry) {
    const allowedNormalized = policy.allowedCountries
      .map((country) => normalizeCountryCode(country))
      .filter((country): country is string => Boolean(country));

    if (allowedNormalized.length > 0 && !allowedNormalized.includes(ipCountry)) {
      return {
        allowed: false,
        reason: "ip_country_not_allowed",
        effectiveScore: result.score,
      };
    }
  }

  if (policy?.treatVpnAsFailure && details?.security) {
    const security = details.security;
    if (security.vpn || security.proxy || security.tor || security.relay) {
      return {
        allowed: false,
        reason: "ip_security_not_allowed",
        effectiveScore: result.score,
      };
    }
  }

  if (result.score < minScore) {
    return {
      allowed: false,
      reason: "score_below_min",
      effectiveScore: result.score,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    effectiveScore: result.score,
  };
}

export function getClientTimeZone(): string | null {
  if (typeof Intl === "undefined") return null;
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
}

export function getClientOffsetMin(): number | null {
  if (typeof Date === "undefined") return null;
  return -new Date().getTimezoneOffset();
}

export function getNavigatorCountryCode(): string | null {
  if (typeof navigator === "undefined") return null;

  const anyNav = navigator as Navigator & {
    language?: string;
    languages?: string[];
  };

  const lang = anyNav.language || (Array.isArray(anyNav.languages) ? anyNav.languages[0] : undefined);

  if (!lang || typeof lang !== "string") return null;

  const parts = lang.split("-");
  if (parts.length >= 2) {
    const country = parts[1];
    if (country && country.length >= 2) {
      return country.toUpperCase();
    }
  }

  if (lang.length === 2) {
    return lang.toUpperCase();
  }

  return null;
}
