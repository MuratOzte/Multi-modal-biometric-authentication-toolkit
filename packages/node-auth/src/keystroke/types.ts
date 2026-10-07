export interface KeystrokeSampleMeta {
  timestamp: number;
  durationMs: number;
  invalid?: boolean;
  invalidReason?: string;
}

export type KeystrokeCorrectionEventType = "mismatch" | "extra" | "backspace";

export interface KeystrokeCorrectionEvent {
  type: KeystrokeCorrectionEventType;
  t: number;
  index: number;
  key?: string;
  expected?: string;
  removed?: string;
}

export interface KeystrokeCorrections {
  events: KeystrokeCorrectionEvent[];
  mismatchCount: number;
  extraCount: number;
  backspaceCount: number;
}

export interface KeystrokeSample {
  textId: string;
  text: string;
  holdMs: number[];
  ddMs: number[];
  udMs: number[];
  meta: KeystrokeSampleMeta;
  corrections?: KeystrokeCorrections;
}

export interface Template {
  userIdHash: string;
  textId: string;
  expectedTextHash: string;
  dim: number;
  count: number;
  mean: number[];
  std: number[];
  distThreshold: number;
  scoreK: number;
  autoEnrollScore: number;
  scoreThreshold: number;
  updatedAt: number;
}

export interface EnrollReq {
  userId: string;
  textId: string;
  expectedText: string;
  samples: KeystrokeSample[];
}

export interface EnrollRes {
  ok: true;
  enrolled: true;
  template: {
    count: number;
    dim: number;
  };
  recommended: {
    distThreshold: number;
    scoreThreshold: number;
    autoEnrollScore: number;
  };
}

export interface VerifyReq {
  userId: string;
  textId: string;
  expectedText?: string;
  sample: KeystrokeSample;
  opts?: {
    autoEnroll?: boolean;
  };
}

export interface VerifyRes {
  ok: true;
  decision: "accept" | "reject";
  score: number;
  dist: number;
  autoEnrolled: boolean;
  reason?: string;
  metrics: {
    count: number;
    thresholdDist: number;
    thresholdScore: number;
    autoEnrollScore: number;
  };
}

export interface PythonBridgeOpts {
  thresholds?: {
    distThreshold?: number;
    scoreThreshold?: number;
    autoEnrollScore?: number;
    scoreK?: number;
    minEnroll?: number;
  };
  autoEnroll?: boolean;
  stdFloorMs?: number;
  minEnroll?: number;
  maxAgeMs?: number;
  nowMs?: number;
}

export interface PythonBridgeInput {
  op: "enroll" | "verify";
  template: Template | null;
  samples: KeystrokeSample[];
  opts?: PythonBridgeOpts;
}

export interface PythonEnrollOutput {
  ok: true;
  template: Omit<Template, "userIdHash" | "textId" | "expectedTextHash" | "updatedAt"> & {
    updatedAt?: number;
  };
  recommended: {
    distThreshold: number;
    scoreThreshold: number;
    autoEnrollScore: number;
  };
}

export interface PythonVerifyOutput {
  ok: true;
  score: number;
  dist: number;
  decision: "accept" | "reject";
  autoEnrolled: boolean;
  reason?: string;
  template?: Omit<Template, "userIdHash" | "textId" | "expectedTextHash" | "updatedAt"> & {
    updatedAt?: number;
  };
}

export interface PythonErrorOutput {
  ok: false;
  error: string;
  details?: string;
}

export type PythonBridgeOutput = PythonEnrollOutput | PythonVerifyOutput | PythonErrorOutput;
