import type { LocationResult, NetworkResult } from "../contracts/verify";
import type { SessionPolicy } from "../contracts/session";
import { DEFAULT_SESSION_POLICY } from "./policy";

export type AggregateInput = {
  network?: NetworkResult;
  location?: LocationResult;
  policy: SessionPolicy;
};

const NETWORK_WEIGHT = 0.7;
const COUNTRY_NOT_ALLOWED_RISK = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPercentScale(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 0 && value <= 1) return value * 100;
  return value;
}

function normalizeTrustScore(value: number): number {
  return clamp(toPercentScale(value), 0, 100);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function aggregateRisk(input: AggregateInput): { riskScore: number; reasons: string[] } {
  const denyMinRisk = input.policy.denyMinRisk ?? DEFAULT_SESSION_POLICY.denyMinRisk;
  const reasons: string[] = [];
  let risk = 0;

  if (input.network) {
    const trustScore = normalizeTrustScore(input.network.score);
    const networkRisk = 100 - trustScore;
    risk += networkRisk * NETWORK_WEIGHT;

    if (input.network.flags.vpn) reasons.push("VPN_DETECTED");
    if (input.network.flags.proxy) reasons.push("PROXY_DETECTED");
    if (input.network.flags.tor) reasons.push("TOR_DETECTED");
    if (input.network.flags.relay) reasons.push("RELAY_DETECTED");
    if (input.network.flags.hosting) reasons.push("HOSTING_DETECTED");
    if (input.network.flags.suspicious) reasons.push("SUSPICIOUS_NETWORK");

    reasons.push(...input.network.reasons);
  }

  if (input.location?.allowed === false) {
    risk += COUNTRY_NOT_ALLOWED_RISK;
    reasons.push("COUNTRY_NOT_ALLOWED");
  }

  if (typeof input.policy.minNetworkScore === "number" && input.network) {
    const minNetworkScore = normalizeTrustScore(input.policy.minNetworkScore);
    const trustScore = normalizeTrustScore(input.network.score);
    if (trustScore < minNetworkScore) {
      risk += (minNetworkScore - trustScore) * 0.5;
      reasons.push("NETWORK_SCORE_BELOW_MIN");
    }
  }

  if (input.policy.treatVpnAsFailure && input.network?.flags.vpn) {
    risk = Math.max(risk, denyMinRisk);
    reasons.push("VPN_TREATED_AS_FAILURE");
  }

  return {
    riskScore: clamp(Math.round(risk), 0, 100),
    reasons: uniq(reasons),
  };
}
