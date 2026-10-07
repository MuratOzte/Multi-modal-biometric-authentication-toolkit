import type { ChallengeAdapter, ChallengeRunContext, ChallengeResult } from "@securekit/core";

export class VpnCheckAdapter implements ChallengeAdapter {
  id() { return "vpn:check"; }
  async isReady() { return true; }
  async run(_ctx: ChallengeRunContext): Promise<ChallengeResult> {
    return { proof: { localIpHint: "unknown" } };
  }
}
