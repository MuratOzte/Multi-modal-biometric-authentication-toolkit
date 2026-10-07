export interface ChallengeRunContext {
  userId: string;
  sessionId: string;
  nonce: string;
  policy?: unknown;
}

export interface ChallengeResult {
  proof: unknown;
  metrics?: Record<string, unknown>;
}

export interface ServerVerifyResult {
  ok: boolean;
  score?: number;
  error?: string;
}

export interface ChallengeAdapter {
  id(): string;
  isReady(policy?: unknown): Promise<boolean> | boolean;
  run(ctx: ChallengeRunContext): Promise<ChallengeResult>;
  verifyLocal?(proof: unknown, policy?: unknown): Promise<ServerVerifyResult> | ServerVerifyResult;
}

export interface PolicyStep {
  use: string;
  required?: boolean;
  params?: unknown;
  weight?: number;
}

export interface Policy {
  steps: PolicyStep[];
  passScore: number;
}

export interface Transport {
  verify(use: string, payload: { proof: unknown; metrics?: unknown; context: ChallengeRunContext }): Promise<ServerVerifyResult>;
}
