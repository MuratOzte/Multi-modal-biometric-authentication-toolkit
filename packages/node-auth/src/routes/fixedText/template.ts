import type { PythonEnrollOutput, PythonVerifyOutput, Template } from "../../keystroke/types";

export function buildStoredTemplate(args: {
  rawTemplate: PythonEnrollOutput["template"] | PythonVerifyOutput["template"];
  base: Pick<Template, "userIdHash" | "textId" | "expectedTextHash">;
  updatedAt: number;
}): Template {
  if (!args.rawTemplate) {
    throw new Error("Template payload missing.");
  }

  return {
    userIdHash: args.base.userIdHash,
    textId: args.base.textId,
    expectedTextHash: args.base.expectedTextHash,
    dim: Math.round(args.rawTemplate.dim),
    count: Math.round(args.rawTemplate.count),
    mean: [...args.rawTemplate.mean],
    std: [...args.rawTemplate.std],
    distThreshold: args.rawTemplate.distThreshold,
    scoreK: args.rawTemplate.scoreK,
    autoEnrollScore: args.rawTemplate.autoEnrollScore,
    scoreThreshold: args.rawTemplate.scoreThreshold,
    updatedAt: args.updatedAt,
  };
}
