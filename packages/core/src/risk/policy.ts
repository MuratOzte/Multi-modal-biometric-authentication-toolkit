import type { SessionPolicy, VerifyStep } from "../contracts/session";

type RequiredSessionPolicyKeys =
  | "allowMaxRisk"
  | "denyMinRisk"
  | "stepUpSteps"
  | "treatVpnAsFailure";

export type ResolvedSessionPolicy = Required<Pick<SessionPolicy, RequiredSessionPolicyKeys>> &
  Pick<SessionPolicy, "allowedCountries" | "minNetworkScore" | "keystroke" | "voice">;

const DEFAULT_STEP_UP_STEPS: VerifyStep[] = ["keystroke"];

export const DEFAULT_SESSION_POLICY: ResolvedSessionPolicy = {
  allowMaxRisk: 30,
  denyMinRisk: 85,
  stepUpSteps: DEFAULT_STEP_UP_STEPS,
  treatVpnAsFailure: false,
  allowedCountries: undefined,
  minNetworkScore: undefined,
  keystroke: {
    enabled: false,
  },
  voice: {
    enabled: false,
  },
};

export function resolveSessionPolicy(policy?: SessionPolicy): ResolvedSessionPolicy {
  if (!policy) {
    return {
      ...DEFAULT_SESSION_POLICY,
      stepUpSteps: [...DEFAULT_SESSION_POLICY.stepUpSteps],
    };
  }

  return {
    allowMaxRisk: policy.allowMaxRisk ?? DEFAULT_SESSION_POLICY.allowMaxRisk,
    denyMinRisk: policy.denyMinRisk ?? DEFAULT_SESSION_POLICY.denyMinRisk,
    stepUpSteps: [...(policy.stepUpSteps ?? DEFAULT_SESSION_POLICY.stepUpSteps)],
    treatVpnAsFailure: policy.treatVpnAsFailure ?? DEFAULT_SESSION_POLICY.treatVpnAsFailure,
    allowedCountries: policy.allowedCountries,
    minNetworkScore: policy.minNetworkScore,
    keystroke: policy.keystroke ?? DEFAULT_SESSION_POLICY.keystroke,
    voice: policy.voice ?? DEFAULT_SESSION_POLICY.voice,
  };
}
