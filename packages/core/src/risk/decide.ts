import type {
  RequiredStep,
  RiskDecision,
  SessionPolicy,
  StepUi,
  VerifyStep,
} from "../contracts/session";
import { DEFAULT_SESSION_POLICY } from "./policy";

const STEP_UI_MAP: Record<VerifyStep, StepUi> = {
  network: {
    title: "Network Check",
    instruction: "Complete network verification.",
  },
  location: {
    title: "Location Check",
    instruction: "Complete location verification.",
  },
  keystroke: {
    title: "Typing Check",
    instruction: "Type the shown text naturally.",
  },
  face: {
    title: "Face Liveness",
    instruction: "Follow the on-screen liveness instructions.",
  },
  voice: {
    title: "Voice Check",
    instruction: "Read the shown text clearly.",
  },
  object: {
    title: "Object Check",
    instruction: "Show the requested object to the camera.",
  },
  passkey: {
    title: "Passkey",
    instruction: "Confirm with your passkey.",
  },
};

function toRequiredStep(step: VerifyStep): RequiredStep {
  return {
    step,
    ui: STEP_UI_MAP[step],
  };
}

export function decideNext(args: {
  riskScore: number;
  policy: SessionPolicy;
}): { decision: RiskDecision; requiredSteps: RequiredStep[]; reasons: string[] } {
  const allowMaxRisk = args.policy.allowMaxRisk ?? DEFAULT_SESSION_POLICY.allowMaxRisk;
  const denyMinRisk = args.policy.denyMinRisk ?? DEFAULT_SESSION_POLICY.denyMinRisk;
  const configuredSteps = args.policy.stepUpSteps ?? DEFAULT_SESSION_POLICY.stepUpSteps;

  if (args.riskScore <= allowMaxRisk) {
    return {
      decision: "allow",
      requiredSteps: [],
      reasons: ["RISK_WITHIN_ALLOW_MAX"],
    };
  }

  if (args.riskScore >= denyMinRisk) {
    return {
      decision: "deny",
      requiredSteps: [],
      reasons: ["RISK_AT_OR_ABOVE_DENY_MIN"],
    };
  }

  const challengeSteps = configuredSteps.filter(
    (step) => step !== "network" && step !== "location"
  );
  const stepsToUse: VerifyStep[] =
    challengeSteps.length > 0 ? challengeSteps : ["keystroke"];

  return {
    decision: "step-up",
    requiredSteps: stepsToUse.map(toRequiredStep),
    reasons: ["RISK_REQUIRES_STEP_UP"],
  };
}
