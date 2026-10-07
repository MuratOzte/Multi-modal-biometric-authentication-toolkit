import type { ChallengeAdapter, ChallengeRunContext, Policy, ServerVerifyResult, Transport } from "./contracts";

function makeNonce() {
  try {
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch {}
  return Math.random().toString(36).slice(2);
}

export class Orchestrator {
  private adapters: Map<string, ChallengeAdapter>;
  private transport: Transport;

  constructor(opts: { adapters: ChallengeAdapter[]; transport: Transport }) {
    this.adapters = new Map(opts.adapters.map(a => [a.id(), a]));
    this.transport = opts.transport;
  }

  async run(policy: Policy, baseCtx: Omit<ChallengeRunContext, "nonce"> & { nonce?: string }) {
    const context: ChallengeRunContext = {
      ...baseCtx,
      nonce: baseCtx.nonce ?? makeNonce()
    };
    const results: { use: string; server: ServerVerifyResult }[] = [];

    for (const step of policy.steps) {
      const adapter = this.adapters.get(step.use);
      if (!adapter) throw new Error(`Adapter not found: ${step.use}`);
      const ready = await adapter.isReady(step.params);
      if (!ready) {
        if (step.required) throw new Error(`${step.use} not ready`);
        continue;
      }
      const { proof, metrics } = await adapter.run({ ...context, policy: step.params });
      const server = await this.transport.verify(step.use, { proof, metrics, context });
      if (step.required && !server.ok) throw new Error(`${step.use} failed`);
      results.push({ use: step.use, server });
    }
    const score = this.aggregate(results, policy);
    return { ok: score >= policy.passScore, score, results };
  }

  private aggregate(results: { use: string; server: ServerVerifyResult }[], policy: Policy): number {
    let sum = 0, wsum = 0;
    for (const s of policy.steps) {
      const r = results.find(x => x.use === s.use);
      if (!r) continue;
      const w = s.weight ?? 1;
      const v = typeof r.server.score === "number" ? r.server.score : (r.server.ok ? 1 : 0);
      sum += v * w;
      wsum += w;
    }
    return wsum ? sum / wsum : 1;
  }
}
