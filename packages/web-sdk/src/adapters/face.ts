import type { ChallengeAdapter, ChallengeRunContext, ChallengeResult } from "@securekit/core";

export class FaceLivenessAdapter implements ChallengeAdapter {
  id() { return "face:liveness"; }
  async isReady() { return typeof window !== "undefined"; }
  async run(ctx: ChallengeRunContext): Promise<ChallengeResult> {
    // Demo: görevler ve kalite metriği stub
    return { proof: { tasksOk: true, nonce: ctx.nonce }, metrics: { quality: 0.9 } };
  }
}
