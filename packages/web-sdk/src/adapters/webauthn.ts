import type { ChallengeAdapter, ChallengeRunContext, ChallengeResult } from "@securekit/core";

export class WebAuthnAdapter implements ChallengeAdapter {
  id() { return "webauthn:passkey"; }
  async isReady() { return typeof window !== "undefined" && !!(window as any).PublicKeyCredential; }
  async run(ctx: ChallengeRunContext): Promise<ChallengeResult> {
    // Demo: gerçek WebAuthn yerine kanıt stub'u
    return { proof: { type: "webauthn-demo", nonce: ctx.nonce } };
  }
}
