import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FaceEnrollmentReferenceResponse,
  FaceSlidingWindowVerificationResult,
  FaceVerificationResult as CoreFaceVerificationResult,
  GetProfilesResponse,
} from "@securekit/core";
import {
  createSecureKitClient,
  formatSecureKitError,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";
import {
  runFaceCaptureSeries,
  type FaceSeriesProgress,
} from "../lib/faceCaptureSeries.js";

type BusyState = "idle" | "enroll" | "verify";
type FaceUserId = string;
type LivenessState = "idle" | "running" | "capturing" | "done" | "failed";
type FlashTestStatus = "idle" | "waiting" | "sampling" | "passed" | "failed";

type FaceUserOption = {
  value: string;
  label: string;
};

type FaceProfileStatus = {
  state: "loading" | "registered" | "unregistered" | "unknown";
  imagePath: string | null;
  enrolledAt: string | null;
  legacy: boolean;
  error: string | null;
};

type LivenessCheckResult = {
  ok: boolean;
  score: number;
  details?: unknown;
};

type IlluminationMetrics = {
  illuminationOk: boolean;
  baselineY: number;
  flashY: number;
  recoveryY: number;
  deltaY: number;
  relativeDelta: number;
  sampleCount: number;
  saturatedRatio: number;
};

type FlashTestSummary = {
  status: FlashTestStatus;
  passed: boolean;
  reason: string;
  metrics: IlluminationMetrics | null;
  thresholds: {
    deltaYMin: number;
    relativeDeltaMin: number;
    saturatedRatioMax: number;
    overexposedY: number;
  };
};

type FaceVerificationJson = (FaceSlidingWindowVerificationResult | CoreFaceVerificationResult) & {
  flashTest?: FlashTestSummary;
};

type ChallengeStep = {
  id: string;
  label: string;
};

type ChallengeStatus = "pending" | "passed" | "failed";

type Thresholds = {
  PAD_PASS: number;
  YAW_REQ_DEG: number;
  PITCH_REQ_DEG: number;
  MOTION_STD_MIN: number;
  FLASH_DELTA_MIN: number;
  GUIDE: { x: number; y: number; w: number; h: number };
  MIN_FACE_W: number;
  MAX_FACE_W: number;
  POSE_ALIGN_YAW: number;
  POSE_ALIGN_PITCH: number;
  EAR_CLOSE: number;
  EAR_OPEN: number;
  MAR_OPEN: number;
  BLINK_MIN_FR: number;
  BLINK_MAX_FR: number;
  BLINK_COOLDOWN: number;
  PITCH_UP_DEG: number;
  HEAD_HOLD_FR: number;
  MOUTH_HOLD_FR: number;
  POSE_HOLD_FR: number;
  EXPRESSION_HOLD_FR: number;
  YAW_TURN_DEG: number;
  PITCH_TURN_DEG: number;
  ROLL_TILT_DEG: number;
  STEP_TIMEOUT_MS: number;
};

type BlendshapeScores = {
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  eyeLookOutLeft: number;
  eyeLookOutRight: number;
  eyeLookInLeft: number;
  eyeLookInRight: number;
  eyeLookUpLeft: number;
  eyeLookUpRight: number;
  eyeLookDownLeft: number;
  eyeLookDownRight: number;
  mouthOpen: number;
  jawOpen: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  cheekPuff: number;
  jawLeft: number;
  jawRight: number;
  browInnerUp: number;
  browOuterUpLeft: number;
  browOuterUpRight: number;
};

type StepMeasurement = {
  EAR: number;
  MAR: number;
  yawAdj: number;
  pitchAdj: number;
  rollDeg: number;
  bs: BlendshapeScores;
  blinkEvent: boolean;
};

type NormalizedBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
};

type BrightnessSample = {
  y: number;
  saturatedRatio: number;
};

type DebugMetrics = {
  ear: string;
  earClose: string;
  earOpen: string;
  mar: string;
  marOpen: string;
  yaw: string;
  yawAdj: string;
  pitch: string;
  pitchAdj: string;
  roll: string;
};

type MediaPipeBlendshapeCategory = {
  categoryName?: string;
  score?: number;
};

type FaceLandmarkerResult = {
  faceLandmarks?: Array<Array<{ x: number; y: number }>>;
  faceBlendshapes?: Array<{ categories?: MediaPipeBlendshapeCategory[] }>;
};

type FaceLandmarker = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number
  ) => FaceLandmarkerResult | Promise<FaceLandmarkerResult>;
  close?: () => void;
};

type DrawingUtilsLike = {
  drawLandmarks?: (
    landmarks: Array<{ x: number; y: number }>,
    options?: { color?: string; radius?: number }
  ) => void;
};

type VisionBundle = {
  FilesetResolver: {
    forVisionTasks: (baseUrl: string) => Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>
    ) => Promise<FaceLandmarker>;
  };
  DrawingUtils: new (context: CanvasRenderingContext2D) => DrawingUtilsLike;
};

const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const DEFAULT_FACE_USERS: FaceUserOption[] = [
  { value: "emre", label: "Emre" },
  { value: "murat", label: "Murat" },
  { value: "mert", label: "Mert" },
];
const VISION_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task?v=1";

const MIN_FRAME_INTERVAL = 1000 / 30;
const STALL_TIMEOUT = 4000;
const FAIL_LIMIT = 3;
const POSE_MED_FRAMES = 36;
const TRAIL_MAX = 40;
const FLASH_SAMPLE_FRAMES = 5;
const FLASH_FRAME_DELAY_MS = 45;
const FLASH_CAPTURE_DELAY_MS = 200;
const FLASH_RELATIVE_DELTA_MIN = 0.04;
const FLASH_SATURATED_RATIO_MAX = 0.35;
const FLASH_OVEREXPOSED_Y = 245;

const EMPTY_DEBUG_METRICS: DebugMetrics = {
  ear: "-",
  earClose: "-",
  earOpen: "-",
  mar: "-",
  marOpen: "-",
  yaw: "-",
  yawAdj: "-",
  pitch: "-",
  pitchAdj: "-",
  roll: "-",
};
const PREVIEW_FRAME_STYLE: React.CSSProperties = {
  height: "clamp(180px, 32vw, 220px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  boxSizing: "border-box",
  borderRadius: 10,
  border: "1px solid #d0d5dd",
  background: "linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%)",
  overflow: "hidden",
};
const PREVIEW_IMAGE_STYLE: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  width: "auto",
  height: "auto",
  display: "block",
  objectFit: "contain",
  objectPosition: "center",
};
const PREVIEW_EMPTY_STYLE: React.CSSProperties = {
  ...PREVIEW_FRAME_STYLE,
  border: "1px dashed #d0d5dd",
  color: "#475467",
};
const COMPACT_PANEL_STYLE: React.CSSProperties = {
  minHeight: 72,
  display: "grid",
  gap: 8,
  alignContent: "center",
  padding: 12,
  boxSizing: "border-box",
  borderRadius: 10,
  border: "1px solid #d0d5dd",
  background: "linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%)",
};

const EMPTY_FACE_PROFILE_STATUS: FaceProfileStatus = {
  state: "loading",
  imagePath: null,
  enrolledAt: null,
  legacy: false,
  error: null,
};

const TH_DEFAULTS: Thresholds = {
  PAD_PASS: 0.8,
  YAW_REQ_DEG: 15,
  PITCH_REQ_DEG: 10,
  MOTION_STD_MIN: 0.008,
  FLASH_DELTA_MIN: 5,
  GUIDE: { x: 0.18, y: 0.12, w: 0.64, h: 0.76 },
  MIN_FACE_W: 0.1,
  MAX_FACE_W: 0.95,
  POSE_ALIGN_YAW: 18,
  POSE_ALIGN_PITCH: 18,
  EAR_CLOSE: 0.18,
  EAR_OPEN: 0.23,
  MAR_OPEN: 0.3,
  BLINK_MIN_FR: 2,
  BLINK_MAX_FR: 10,
  BLINK_COOLDOWN: 6,
  PITCH_UP_DEG: 12,
  HEAD_HOLD_FR: 8,
  MOUTH_HOLD_FR: 8,
  POSE_HOLD_FR: 8,
  EXPRESSION_HOLD_FR: 8,
  YAW_TURN_DEG: 20,
  PITCH_TURN_DEG: 15,
  ROLL_TILT_DEG: 12,
  STEP_TIMEOUT_MS: 12000,
};

const CHALLENGE_POOL: readonly ChallengeStep[] = [
  { id: "BLINK", label: "Blink your eyes" },
  { id: "MOUTH", label: "Open your mouth" },
  { id: "SMILE", label: "Smile" },
  { id: "BROW_RAISE", label: "Raise your eyebrows" },
  { id: "TURN_LEFT", label: "Turn your head sideways (left or right)" },
];

function toPreviewUrl(file: Blob | null): string | null {
  if (!file) return null;
  return URL.createObjectURL(file);
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeUserIdInput(value: string): string {
  return value.trim().toLowerCase();
}

function isValidUserId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

function formatUserLabel(value: string): string {
  const parts = value.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return value;
  return parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function mergeFaceUsers(...groups: FaceUserOption[][]): FaceUserOption[] {
  const merged = new Map<string, FaceUserOption>();

  groups.flat().forEach((user) => {
    const value = normalizeUserIdInput(user.value);
    if (!value || merged.has(value)) return;
    merged.set(value, {
      value,
      label: user.label.trim() || formatUserLabel(value),
    });
  });

  return Array.from(merged.values());
}

function resolveFaceProfileStatus(response: GetProfilesResponse): FaceProfileStatus {
  const { profiles } = response;
  const hasReference = typeof profiles.faceReferenceImagePath === "string" && profiles.faceReferenceImagePath.length > 0;
  const hasLegacyEmbedding = Array.isArray(profiles.faceEmbedding) && profiles.faceEmbedding.length > 0;

  return {
    state: hasReference || hasLegacyEmbedding ? "registered" : "unregistered",
    imagePath: profiles.faceReferenceImagePath ?? null,
    enrolledAt: profiles.faceReferenceEnrolledAt ?? profiles.updatedAt ?? null,
    legacy: !hasReference && hasLegacyEmbedding,
    error: null,
  };
}

function faceStatusLabel(status: FaceProfileStatus): string {
  if (status.state === "loading") return "Kontrol ediliyor...";
  if (status.state === "registered") return "Kayitli";
  if (status.state === "unregistered") return "Kayitli degil";
  return "Durum okunamadi";
}

function faceStatusDetail(status: FaceProfileStatus): string {
  if (status.state === "loading") return "Durum guncelleniyor.";
  if (status.state === "unknown") return status.error ?? "Profil durumu okunamadi.";
  if (status.legacy) return "Mevcut yuz embedding profili bulundu.";
  if (status.imagePath) return status.enrolledAt ? `Referans: ${status.enrolledAt}` : "Yuz referansi var.";
  return "Referans fotograf kaydedilmemis.";
}

function faceStatusStyle(status: FaceProfileStatus): React.CSSProperties {
  if (status.state === "registered") {
    return { color: "#166534", fontWeight: 700 };
  }
  if (status.state === "unregistered") {
    return { color: "#b42318", fontWeight: 700 };
  }
  if (status.state === "unknown") {
    return { color: "#92400e", fontWeight: 700 };
  }
  return { color: "#475467", fontWeight: 700 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function shuffle<T>(input: readonly T[]): T[] {
  const data = [...input];
  for (let index = data.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = data[index];
    data[index] = data[swapIndex];
    data[swapIndex] = current;
  }
  return data;
}

function ema(prev: number | null, value: number, k = 0.3): number {
  if (prev === null) return value;
  return prev * (1 - k) + value * k;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function flashStatusText(status: FlashTestStatus): string {
  if (status === "waiting") return "Flash testi baslamak uzere";
  if (status === "sampling") return "Flash testi olculuyor";
  if (status === "passed") return "Flash testi basarili";
  if (status === "failed") return "Flash testi basarisiz";
  return "Challenge'lar bitince otomatik calisir";
}

function flashStatusStyle(status: FlashTestStatus): React.CSSProperties {
  const palette =
    status === "passed"
      ? { border: "#9ae6b4", background: "#e6ffed", color: "#067d1f" }
      : status === "failed"
        ? { border: "#fda29b", background: "#fff1f0", color: "#b42318" }
        : status === "waiting" || status === "sampling"
          ? { border: "#93c5fd", background: "#eff6ff", color: "#1d4ed8" }
          : { border: "#d0d5dd", background: "#f8fafc", color: "#475467" };

  return {
    display: "inline-block",
    marginLeft: 6,
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 12,
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
  };
}

function isFlashTestComplete(status: FlashTestStatus): boolean {
  return status === "passed" || status === "failed";
}

function captureSeriesStatusText(progress: FaceSeriesProgress): string {
  if (progress.phase === "capture") {
    return `Capturing selfie ${progress.index}/${progress.total}. Keep your face steady.`;
  }
  if (progress.phase === "verify") {
    return `Analyzing selfie ${progress.index}/${progress.total}.`;
  }
  return `Waiting for next selfie (${progress.index}/${progress.total}).`;
}

function bestScoreText(result: FaceSlidingWindowVerificationResult | null | undefined): string {
  return typeof result?.score === "number" ? result.score.toFixed(3) : "none";
}

function flashFailureReason(
  metrics: IlluminationMetrics | null,
  status: FlashTestStatus,
  thresholds: Thresholds
): string {
  if (!metrics) {
    if (status === "failed") return "insufficient_samples";
    if (status === "waiting" || status === "sampling") return "measurement_in_progress";
    return "not_measured";
  }
  if (metrics.illuminationOk) return "passed";
  if (metrics.baselineY >= FLASH_OVEREXPOSED_Y || metrics.flashY >= FLASH_OVEREXPOSED_Y) {
    return "overexposed";
  }
  if (metrics.saturatedRatio > FLASH_SATURATED_RATIO_MAX) {
    return "saturated";
  }
  if (metrics.deltaY < thresholds.FLASH_DELTA_MIN) {
    return "delta_below_threshold";
  }
  if (metrics.relativeDelta < FLASH_RELATIVE_DELTA_MIN) {
    return "relative_delta_below_threshold";
  }
  return "unknown";
}

function buildFlashTestSummary(
  metrics: IlluminationMetrics | null,
  status: FlashTestStatus,
  thresholds: Thresholds
): FlashTestSummary {
  return {
    status,
    passed: Boolean(metrics?.illuminationOk),
    reason: flashFailureReason(metrics, status, thresholds),
    metrics,
    thresholds: {
      deltaYMin: thresholds.FLASH_DELTA_MIN,
      relativeDeltaMin: FLASH_RELATIVE_DELTA_MIN,
      saturatedRatioMax: FLASH_SATURATED_RATIO_MAX,
      overexposedY: FLASH_OVEREXPOSED_Y,
    },
  };
}

function buildOptionalFlashTestSummary(
  metrics: IlluminationMetrics | null,
  status: FlashTestStatus,
  thresholds: Thresholds
): FlashTestSummary | undefined {
  if (!metrics && status === "idle") return undefined;
  return buildFlashTestSummary(metrics, status, thresholds);
}

function isPoseChallenge(id: string): boolean {
  return ["TURN_LEFT", "TURN_RIGHT", "LOOK_UP", "LOOK_DOWN", "HEAD_UP", "TILT_LEFT", "TILT_RIGHT"].includes(id);
}

function isExpressionChallenge(id: string): boolean {
  return ["BLINK", "WINK_LEFT", "WINK_RIGHT", "MOUTH", "SMILE", "BROW_RAISE", "JAW_LEFT", "JAW_RIGHT"].includes(id);
}

function isEyeGazeChallenge(id: string): boolean {
  return id.startsWith("EYE_LOOK_");
}

function computeEAR(landmarks: Array<{ x: number; y: number }>): number {
  const left = [33, 160, 158, 133, 153, 144].map((index) => landmarks[index]);
  const right = [263, 387, 385, 362, 380, 373].map((index) => landmarks[index]);
  const earLeft = (dist(left[1], left[2]) + dist(left[4], left[5])) / (2 * dist(left[0], left[3]));
  const earRight = (dist(right[1], right[2]) + dist(right[4], right[5])) / (2 * dist(right[0], right[3]));
  return (earLeft + earRight) / 2;
}

function computeMAR(landmarks: Array<{ x: number; y: number }>): number {
  const top = landmarks[13];
  const bottom = landmarks[14];
  const left = landmarks[61];
  const right = landmarks[291];
  const vertical = dist(top, bottom);
  const width = dist(left, right) || 0.000001;
  return vertical / width;
}

function estimateYawPitch(landmarks: Array<{ x: number; y: number }>): { yawDeg: number; pitchDeg: number } {
  const left = landmarks[33];
  const right = landmarks[263];
  const nose = landmarks[1];
  const mouth = landmarks[13];
  const browLeft = landmarks[70];
  const browRight = landmarks[300];

  const eyeDist = Math.abs(right.x - left.x) || 0.000001;
  const eyeMidX = (left.x + right.x) / 2;
  let yawDeg = ((nose.x - eyeMidX) / eyeDist) * 60;

  const verticalReference = (browLeft.y + browRight.y) / 2 - mouth.y;
  let pitchDeg = -verticalReference * 200;

  if (!Number.isFinite(yawDeg)) yawDeg = 0;
  if (!Number.isFinite(pitchDeg)) pitchDeg = 0;
  return { yawDeg, pitchDeg };
}

function estimateRoll(landmarks: Array<{ x: number; y: number }>): number {
  const left = landmarks[33];
  const right = landmarks[263];
  const eyeDist = Math.abs(right.x - left.x) || 0.000001;
  const dy = right.y - left.y;
  return ((Math.atan2(dy, eyeDist) * 180) / Math.PI) * 2;
}

function faceBoxNorm(landmarks: Array<{ x: number; y: number }>): NormalizedBox {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  landmarks.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function evaluateAlignment(
  box: NormalizedBox,
  yawAdj: number,
  pitchAdj: number,
  relaxPose: boolean,
  thresholds: Thresholds
): { ok: boolean; hint: string } {
  const guide = thresholds.GUIDE;
  const centerX = (box.minX + box.maxX) / 2;
  const centerY = (box.minY + box.maxY) / 2;

  const insideGuide =
    centerX >= guide.x &&
    centerX <= guide.x + guide.w &&
    centerY >= guide.y &&
    centerY <= guide.y + guide.h;
  const sizeOk = box.w >= thresholds.MIN_FACE_W && box.w <= thresholds.MAX_FACE_W;
  const poseOk =
    Math.abs(yawAdj) <= thresholds.POSE_ALIGN_YAW &&
    Math.abs(pitchAdj) <= thresholds.POSE_ALIGN_PITCH;

  const hints: string[] = [];
  if (!insideGuide) {
    hints.push(`center face in box (cx=${centerX.toFixed(2)}, cy=${centerY.toFixed(2)})`);
  }
  if (!sizeOk) {
    hints.push(`distance: width=${box.w.toFixed(2)} (need ${thresholds.MIN_FACE_W}-${thresholds.MAX_FACE_W})`);
  }
  if (!relaxPose && !poseOk) {
    hints.push(
      `pose: yaw'=${yawAdj.toFixed(1)} deg, pitch'=${pitchAdj.toFixed(1)} deg (+-${thresholds.POSE_ALIGN_YAW}/${thresholds.POSE_ALIGN_PITCH})`
    );
  }

  return {
    ok: insideGuide && sizeOk && (relaxPose ? true : poseOk),
    hint: hints.length ? `Hint: ${hints.join(" | ")}` : "",
  };
}

function drawGuide(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  guide: { x: number; y: number; w: number; h: number }
): void {
  const gx = guide.x * width;
  const gy = guide.y * height;
  const gw = guide.w * width;
  const gh = guide.h * height;
  const corner = Math.max(10, Math.min(gw, gh) * 0.1);

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, width, height);
  ctx.clearRect(gx, gy, gw, gh);

  ctx.strokeStyle = "#00d4ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(gx, gy, gw, gh);

  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + corner, gy);
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx, gy + corner);

  ctx.moveTo(gx + gw, gy);
  ctx.lineTo(gx + gw - corner, gy);
  ctx.moveTo(gx + gw, gy);
  ctx.lineTo(gx + gw, gy + corner);

  ctx.moveTo(gx, gy + gh);
  ctx.lineTo(gx + corner, gy + gh);
  ctx.moveTo(gx, gy + gh);
  ctx.lineTo(gx, gy + gh - corner);

  ctx.moveTo(gx + gw, gy + gh);
  ctx.lineTo(gx + gw - corner, gy + gh);
  ctx.moveTo(gx + gw, gy + gh);
  ctx.lineTo(gx + gw, gy + gh - corner);
  ctx.stroke();

  ctx.restore();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function medianBrightness(samples: BrightnessSample[]): number {
  return median(samples.map((sample) => sample.y));
}

function maxSaturatedRatio(samples: BrightnessSample[]): number {
  return samples.reduce((max, sample) => Math.max(max, sample.saturatedRatio), 0);
}

function createThresholds(): Thresholds {
  return {
    ...TH_DEFAULTS,
    GUIDE: { ...TH_DEFAULTS.GUIDE },
  };
}

function getBlendshapeScore(categories: readonly MediaPipeBlendshapeCategory[], name: string): number {
  const match = categories.find((entry) => entry?.categoryName === name);
  if (!match || typeof match.score !== "number") return 0;
  return match.score;
}

function buildBlendshapeScores(categories: readonly MediaPipeBlendshapeCategory[]): BlendshapeScores {
  return {
    eyeBlinkLeft: getBlendshapeScore(categories, "eyeBlinkLeft"),
    eyeBlinkRight: getBlendshapeScore(categories, "eyeBlinkRight"),
    eyeLookOutLeft: getBlendshapeScore(categories, "eyeLookOutLeft"),
    eyeLookOutRight: getBlendshapeScore(categories, "eyeLookOutRight"),
    eyeLookInLeft: getBlendshapeScore(categories, "eyeLookInLeft"),
    eyeLookInRight: getBlendshapeScore(categories, "eyeLookInRight"),
    eyeLookUpLeft: getBlendshapeScore(categories, "eyeLookUpLeft"),
    eyeLookUpRight: getBlendshapeScore(categories, "eyeLookUpRight"),
    eyeLookDownLeft: getBlendshapeScore(categories, "eyeLookDownLeft"),
    eyeLookDownRight: getBlendshapeScore(categories, "eyeLookDownRight"),
    mouthOpen: getBlendshapeScore(categories, "mouthOpen"),
    jawOpen: getBlendshapeScore(categories, "jawOpen"),
    mouthSmileLeft: getBlendshapeScore(categories, "mouthSmileLeft"),
    mouthSmileRight: getBlendshapeScore(categories, "mouthSmileRight"),
    cheekPuff: getBlendshapeScore(categories, "cheekPuff"),
    jawLeft: getBlendshapeScore(categories, "jawLeft"),
    jawRight: getBlendshapeScore(categories, "jawRight"),
    browInnerUp: getBlendshapeScore(categories, "browInnerUp"),
    browOuterUpLeft: getBlendshapeScore(categories, "browOuterUpLeft"),
    browOuterUpRight: getBlendshapeScore(categories, "browOuterUpRight"),
  };
}

export const FaceVerificationTester: React.FC = () => {
  const baseUrl = useMemo(() => resolveSecureKitBaseUrl(), []);
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [userId, setUserId] = useState<FaceUserId>("emre");
  const [faceUsers, setFaceUsers] = useState<FaceUserOption[]>(DEFAULT_FACE_USERS);
  const [newUserId, setNewUserId] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [userListError, setUserListError] = useState<string | null>(null);
  const [addUserMessage, setAddUserMessage] = useState<string | null>(null);
  const [probeImage, setProbeImage] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<FaceVerificationJson | null>(null);
  const [enrollReferenceResult, setEnrollReferenceResult] =
    useState<FaceEnrollmentReferenceResponse | null>(null);
  const [profileStatus, setProfileStatus] =
    useState<FaceProfileStatus>(EMPTY_FACE_PROFILE_STATUS);
  const [cameraActive, setCameraActive] = useState(false);

  const [probePreviewUrl, setProbePreviewUrl] = useState<string | null>(null);
  const [livenessState, setLivenessState] = useState<LivenessState>("idle");
  const [livenessInstruction, setLivenessInstruction] = useState<string>(
    "Center your face inside the box, then click Start Liveness."
  );
  const [livenessResult, setLivenessResult] = useState<LivenessCheckResult | null>(null);

  const [alignOk, setAlignOk] = useState(false);
  const [alignHint, setAlignHint] = useState("");
  const [currentChallenge, setCurrentChallenge] = useState("-");
  const [challengePlan, setChallengePlan] = useState<ChallengeStep[]>([]);
  const [activeChallengeIndex, setActiveChallengeIndex] = useState(0);
  const [progressText, setProgressText] = useState("0 / 0");
  const [padScore, setPadScore] = useState(0);
  const [padResult, setPadResult] = useState("-");
  const [checks, setChecks] = useState({
    blink: false,
    pose: false,
    motion: false,
    flash: false,
  });
  const [flashTestStatus, setFlashTestStatus] = useState<FlashTestStatus>("idle");
  const [flashMetrics, setFlashMetrics] = useState<IlluminationMetrics | null>(null);
  const [captureSeriesText, setCaptureSeriesText] = useState<string | null>(null);

  const [showMetrics, setShowMetrics] = useState(false);
  const [debugMetrics, setDebugMetrics] = useState<DebugMetrics>(EMPTY_DEBUG_METRICS);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const visionBundleRef = useRef<VisionBundle | null>(null);
  const drawingUtilsRef = useRef<DrawingUtilsLike | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);

  const usingCPURef = useRef(false);
  const runningRef = useRef(false);
  const rafIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const lastDetectOkAtRef = useRef(0);
  const detectFailCountRef = useRef(0);

  const livenessStateRef = useRef<LivenessState>("idle");
  const finalizingRef = useRef(false);
  const flashTestStatusRef = useRef<FlashTestStatus>("idle");
  const flashTestInProgressRef = useRef(false);
  const flashAutoStartedRef = useRef(false);

  const thresholdsRef = useRef<Thresholds>(createThresholds());

  const calibratingRef = useRef(false);
  const calSamplesRef = useRef<Array<{ EAR: number; MAR: number }>>([]);
  const ear0Ref = useRef<number | null>(null);
  const mar0Ref = useRef<number | null>(null);
  const yaw0Ref = useRef(0);
  const pitch0Ref = useRef(0);
  const yawHistRef = useRef<number[]>([]);
  const pitchHistRef = useRef<number[]>([]);

  const yawSmoothRef = useRef<number | null>(null);
  const pitchSmoothRef = useRef<number | null>(null);

  const blinkCountRef = useRef(0);
  const poseYawOkRef = useRef(false);
  const posePitchOkRef = useRef(false);
  const motionOkRef = useRef(false);
  const flashOkRef = useRef(false);
  const alignedRef = useRef(false);

  const noseTrailRef = useRef<Array<{ x: number; y: number }>>([]);
  const earHistRef = useRef<number[]>([]);
  const eyesClosedRef = useRef(false);
  const closedFramesRef = useRef(0);
  const cooldownRef = useRef(0);
  const lastBlinkEventRef = useRef(false);

  const stepsRef = useRef<ChallengeStep[]>([]);
  const stepIdxRef = useRef(0);
  const stepHoldRef = useRef(0);
  const stepStartAtRef = useRef(0);
  const grantedRef = useRef(false);
  const pitchUpSignRef = useRef<1 | -1 | null>(null);
  const neutralCaptureHoldRef = useRef(0);

  const lastFaceBoxRef = useRef<NormalizedBox | null>(null);
  const lastIlluminationMetricsRef = useRef<IlluminationMetrics | null>(null);
  const profileRequestIdRef = useRef(0);

  const refreshFaceUsers = useCallback(async () => {
    try {
      const response = await client.listUsers();
      const backendUsers = response.users.map((user) => ({
        value: user.userId,
        label: formatUserLabel(user.userId),
      }));
      const nextUsers = mergeFaceUsers(DEFAULT_FACE_USERS, backendUsers);

      setFaceUsers(nextUsers);
      setUserListError(null);
      setUserId((current) => {
        const normalized = normalizeUserIdInput(current);
        return nextUsers.some((user) => user.value === normalized)
          ? normalized
          : nextUsers[0]?.value ?? normalized;
      });
    } catch (usersError) {
      setFaceUsers((current) => mergeFaceUsers(DEFAULT_FACE_USERS, current));
      setUserListError(formatSecureKitError(usersError, baseUrl));
    }
  }, [baseUrl, client]);

  useEffect(() => {
    void refreshFaceUsers();
  }, [refreshFaceUsers]);

  const refreshProfileStatus = useCallback(async () => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    setProfileStatus(EMPTY_FACE_PROFILE_STATUS);

    try {
      const response = await client.getProfiles(userId);
      if (profileRequestIdRef.current !== requestId) return;
      setProfileStatus(resolveFaceProfileStatus(response));
    } catch (profileError) {
      if (profileRequestIdRef.current !== requestId) return;
      setProfileStatus({
        ...EMPTY_FACE_PROFILE_STATUS,
        state: "unknown",
        error: formatSecureKitError(profileError, baseUrl),
      });
    }
  }, [baseUrl, client, userId]);

  const handleAddFaceUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedUserId = normalizeUserIdInput(newUserId);

      setAddUserMessage(null);
      if (!isValidUserId(normalizedUserId)) {
        setError(
          "Kullanici ID 2-32 karakter olmali; kucuk harf, rakam, nokta, tire veya alt cizgi kullanin."
        );
        return;
      }

      setAddingUser(true);
      setError(null);

      try {
        const response = await client.register({
          userId: normalizedUserId,
          password: normalizedUserId,
        });
        const nextUser = {
          value: response.userId,
          label: formatUserLabel(response.userId),
        };

        setFaceUsers((current) => mergeFaceUsers(DEFAULT_FACE_USERS, current, [nextUser]));
        setUserId(response.userId);
        setNewUserId("");
        setAddUserMessage(response.created ? "Kisi eklendi ve secildi." : "Kisi secildi.");
        void refreshFaceUsers();
      } catch (addError) {
        setError(formatSecureKitError(addError, baseUrl));
      } finally {
        setAddingUser(false);
      }
    },
    [baseUrl, client, newUserId, refreshFaceUsers]
  );

  useEffect(() => {
    setError(null);
    setVerifyResult(null);
    setLivenessResult(null);
    setEnrollReferenceResult(null);
    void refreshProfileStatus();
  }, [refreshProfileStatus]);

  useEffect(() => {
    const nextUrl = toPreviewUrl(probeImage);
    setProbePreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
  }, [probeImage]);

  useEffect(() => {
    livenessStateRef.current = livenessState;
  }, [livenessState]);

  const setFlashStatus = useCallback((status: FlashTestStatus) => {
    flashTestStatusRef.current = status;
    setFlashTestStatus(status);
  }, []);

  const stopRenderLoop = useCallback(() => {
    runningRef.current = false;
    if (rafIdRef.current) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
  }, []);

  const closeLandmarker = useCallback(() => {
    const landmarker = landmarkerRef.current;
    if (landmarker && typeof landmarker.close === "function") {
      try {
        landmarker.close();
      } catch {
        // ignore close errors
      }
    }
    landmarkerRef.current = null;
    drawingUtilsRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const resetRuntime = useCallback(() => {
    thresholdsRef.current = createThresholds();

    calibratingRef.current = true;
    calSamplesRef.current = [];
    ear0Ref.current = null;
    mar0Ref.current = null;
    yaw0Ref.current = 0;
    pitch0Ref.current = 0;
    yawHistRef.current = [];
    pitchHistRef.current = [];

    yawSmoothRef.current = null;
    pitchSmoothRef.current = null;

    blinkCountRef.current = 0;
    poseYawOkRef.current = false;
    posePitchOkRef.current = false;
    motionOkRef.current = false;
    flashOkRef.current = false;
    alignedRef.current = false;

    noseTrailRef.current = [];
    earHistRef.current = [];
    eyesClosedRef.current = false;
    closedFramesRef.current = 0;
    cooldownRef.current = 0;
    lastBlinkEventRef.current = false;

    stepsRef.current = [];
    stepIdxRef.current = 0;
    stepHoldRef.current = 0;
    stepStartAtRef.current = 0;
    grantedRef.current = false;
    pitchUpSignRef.current = null;
    neutralCaptureHoldRef.current = 0;

    detectFailCountRef.current = 0;
    lastDetectOkAtRef.current = 0;
    lastFrameTimeRef.current = 0;
    usingCPURef.current = false;

    finalizingRef.current = false;
    flashTestInProgressRef.current = false;
    flashAutoStartedRef.current = false;
    lastFaceBoxRef.current = null;
    lastIlluminationMetricsRef.current = null;

    setAlignOk(false);
    setAlignHint("");
    setCurrentChallenge("-");
    setChallengePlan([]);
    setActiveChallengeIndex(0);
    setProgressText("0 / 0");
    setPadScore(0);
    setPadResult("-");
    setChecks({ blink: false, pose: false, motion: false, flash: false });
    setFlashStatus("idle");
    setFlashMetrics(null);
    setCaptureSeriesText(null);
    setDebugMetrics(EMPTY_DEBUG_METRICS);
    setLivenessResult(null);
  }, [setFlashStatus]);

  useEffect(() => {
    return () => {
      if (probePreviewUrl) {
        URL.revokeObjectURL(probePreviewUrl);
      }
      stopRenderLoop();
      closeLandmarker();
      stopStream();
    };
  }, [closeLandmarker, probePreviewUrl, stopRenderLoop, stopStream]);

  const ensureOverlaySize = useCallback(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    overlay.width = width;
    overlay.height = height;
  }, []);

  const readCapturedFrame = useCallback(async (): Promise<{ blob: Blob; quality: number }> => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("Camera video is not ready.");
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
      throw new Error("Camera frame is not available yet.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not capture image from camera.");
    }
    context.drawImage(video, 0, 0, width, height);

    const metricsCanvas = document.createElement("canvas");
    const metricsWidth = 160;
    const metricsHeight = 120;
    metricsCanvas.width = metricsWidth;
    metricsCanvas.height = metricsHeight;
    const metricsContext = metricsCanvas.getContext("2d");
    if (!metricsContext) {
      throw new Error("Could not evaluate selfie quality.");
    }
    metricsContext.drawImage(video, 0, 0, metricsWidth, metricsHeight);

    const pixels = metricsContext.getImageData(0, 0, metricsWidth, metricsHeight).data;
    let brightnessTotal = 0;
    let edgeTotal = 0;

    for (let y = 0; y < metricsHeight; y += 1) {
      for (let x = 0; x < metricsWidth; x += 1) {
        const index = (y * metricsWidth + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const current = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
        brightnessTotal += current;

        if (x > 0) {
          const left = index - 4;
          const leftGray =
            (0.299 * pixels[left] + 0.587 * pixels[left + 1] + 0.114 * pixels[left + 2]) / 255;
          edgeTotal += Math.abs(current - leftGray);
        }
        if (y > 0) {
          const up = index - metricsWidth * 4;
          const upGray =
            (0.299 * pixels[up] + 0.587 * pixels[up + 1] + 0.114 * pixels[up + 2]) / 255;
          edgeTotal += Math.abs(current - upGray);
        }
      }
    }

    const pixelCount = metricsWidth * metricsHeight;
    const avgBrightness = brightnessTotal / pixelCount;
    const edgeDensity = edgeTotal / (pixelCount * 2);
    const brightnessScore = 1 - Math.min(Math.abs(avgBrightness - 0.5) * 2, 1);
    const sharpnessScore = clamp01(edgeDensity / 0.12);
    const quality = clamp01(0.55 * sharpnessScore + 0.45 * brightnessScore);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
    });

    if (!blob) {
      throw new Error("Failed to capture selfie image.");
    }

    return { blob, quality };
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API is not available in this browser.");
      return;
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: 640,
          height: 480,
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      stopStream();
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
        await video.play();
      }

      ensureOverlaySize();
      setCameraActive(true);
    } catch (cameraError) {
      setError(formatSecureKitError(cameraError, baseUrl));
    }
  }, [baseUrl, ensureOverlaySize, stopStream]);

  const stopCamera = useCallback(() => {
    stopRenderLoop();
    closeLandmarker();
    stopStream();

    setCameraActive(false);
    setLivenessState("idle");
    setLivenessInstruction("Center your face inside the box, then click Start Liveness.");
    resetRuntime();
  }, [closeLandmarker, resetRuntime, stopRenderLoop, stopStream]);

  const loadVisionBundle = useCallback(async () => {
    if (visionBundleRef.current) {
      return visionBundleRef.current;
    }

    const moduleUrl = VISION_BUNDLE_URL;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as unknown as VisionBundle;
    visionBundleRef.current = loaded;
    return loaded;
  }, []);

  const createLandmarker = useCallback(
    async (delegate: "GPU" | "CPU") => {
      const vision = await loadVisionBundle();
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
      const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
          delegate,
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFaceGeometry: false,
      });

      const overlay = overlayRef.current;
      if (overlay) {
        const context = overlay.getContext("2d");
        if (context) {
          drawingUtilsRef.current = new vision.DrawingUtils(context);
        }
      }

      return landmarker;
    },
    [loadVisionBundle]
  );

  const loadLandmarker = useCallback(async () => {
    closeLandmarker();

    try {
      landmarkerRef.current = await createLandmarker("GPU");
      usingCPURef.current = false;
    } catch {
      landmarkerRef.current = await createLandmarker("CPU");
      usingCPURef.current = true;
    }

    detectFailCountRef.current = 0;
    lastDetectOkAtRef.current = performance.now();
  }, [closeLandmarker, createLandmarker]);

  const safeDetect = useCallback(
    async (timestamp: number): Promise<FaceLandmarkerResult | null> => {
      const landmarker = landmarkerRef.current;
      const video = videoRef.current;
      if (!landmarker || !video) return null;

      try {
        const result = await landmarker.detectForVideo(video, timestamp);
        lastDetectOkAtRef.current = timestamp;
        detectFailCountRef.current = 0;
        return result;
      } catch {
        detectFailCountRef.current += 1;

        if (!usingCPURef.current && detectFailCountRef.current >= FAIL_LIMIT) {
          try {
            landmarkerRef.current = await createLandmarker("CPU");
            usingCPURef.current = true;
            detectFailCountRef.current = 0;
            const fallback = await landmarkerRef.current.detectForVideo(video, timestamp);
            lastDetectOkAtRef.current = timestamp;
            return fallback;
          } catch {
            return null;
          }
        }

        return null;
      }
    },
    [createLandmarker]
  );

  const updateMotion = useCallback((nose: { x: number; y: number }): boolean => {
    const trail = noseTrailRef.current;
    trail.push({ x: nose.x, y: nose.y });
    if (trail.length > TRAIL_MAX) {
      trail.shift();
    }

    if (trail.length < 8) {
      return false;
    }

    const xs = trail.map((point) => point.x);
    const ys = trail.map((point) => point.y);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;

    const stdX = Math.sqrt(xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0) / xs.length);
    const stdY = Math.sqrt(ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0) / ys.length);

    return Math.max(stdX, stdY) >= thresholdsRef.current.MOTION_STD_MIN;
  }, []);

  const updateBlinkEAR = useCallback((ear: number): boolean => {
    const history = earHistRef.current;
    history.push(ear);
    if (history.length > 20) {
      history.shift();
    }

    const avg = history.reduce((sum, value) => sum + value, 0) / history.length;
    if (cooldownRef.current > 0) {
      cooldownRef.current -= 1;
    }

    const thresholds = thresholdsRef.current;
    if (!eyesClosedRef.current) {
      if (avg < thresholds.EAR_CLOSE) {
        eyesClosedRef.current = true;
        closedFramesRef.current = 1;
      }
      return false;
    }

    closedFramesRef.current += 1;
    if (avg > thresholds.EAR_OPEN) {
      const validBlink =
        closedFramesRef.current >= thresholds.BLINK_MIN_FR &&
        closedFramesRef.current <= thresholds.BLINK_MAX_FR;

      eyesClosedRef.current = false;
      closedFramesRef.current = 0;

      if (validBlink && cooldownRef.current === 0) {
        cooldownRef.current = thresholds.BLINK_COOLDOWN;
        return true;
      }
    }

    return false;
  }, []);

  const syncPadUi = useCallback((): { score: number; padPassed: boolean; readyToCapture: boolean } => {
    const weights = { blink: 0.22, pose: 0.25, motion: 0.2, flash: 0.33 };
    const poseOk = poseYawOkRef.current && posePitchOkRef.current;
    const flashOk = flashOkRef.current;
    const flashComplete = isFlashTestComplete(flashTestStatusRef.current);
    const score =
      (blinkCountRef.current >= 1 ? weights.blink : 0) +
      (poseOk ? weights.pose : 0) +
      (motionOkRef.current ? weights.motion : 0) +
      (flashOk ? weights.flash : 0);

    const finishedChallenges =
      stepsRef.current.length > 0 && stepIdxRef.current >= stepsRef.current.length;
    const padPassed =
      finishedChallenges && flashOk && (grantedRef.current || score >= thresholdsRef.current.PAD_PASS);
    const readyToCapture =
      finishedChallenges &&
      flashComplete &&
      (grantedRef.current || score >= thresholdsRef.current.PAD_PASS || !flashOk);

    setPadScore(score);
    setPadResult(padPassed ? "ACCESS GRANTED" : readyToCapture ? "CAPTURE PENDING" : "Working...");
    setChecks({
      blink: blinkCountRef.current >= 1,
      pose: poseOk,
      motion: motionOkRef.current,
      flash: flashOk,
    });

    if (
      finishedChallenges &&
      !flashComplete &&
      livenessStateRef.current === "running" &&
      !flashTestInProgressRef.current
    ) {
      setLivenessInstruction("Challenges done. Run Flash Test to finish PAD.");
    }

    return { score, padPassed, readyToCapture };
  }, []);

  const startChallenges = useCallback(() => {
    const randomized = shuffle(CHALLENGE_POOL);
    const selected: ChallengeStep[] = [];

    const posePick = randomized.find((task) => isPoseChallenge(task.id));
    if (posePick) selected.push(posePick);

    const gazePick = randomized.find((task) => isEyeGazeChallenge(task.id));
    if (gazePick && !selected.find((task) => task.id === gazePick.id)) {
      selected.push(gazePick);
    }

    const exprPick = randomized.find((task) => isExpressionChallenge(task.id));
    if (exprPick && !selected.find((task) => task.id === exprPick.id)) {
      selected.push(exprPick);
    }

    for (const task of randomized) {
      if (selected.length >= 5) break;
      if (!selected.find((candidate) => candidate.id === task.id)) {
        selected.push(task);
      }
    }

    const steps = shuffle(selected.slice(0, 5));
    stepsRef.current = steps;
    stepIdxRef.current = 0;
    stepHoldRef.current = 0;
    stepStartAtRef.current = performance.now();
    grantedRef.current = false;

    setChallengePlan(steps);
    setActiveChallengeIndex(0);
    setCurrentChallenge(steps[0]?.label ?? "-");
    setProgressText(`0 / ${steps.length}`);
    setLivenessInstruction("Calibrating... keep neutral face inside the box.");
  }, []);

  const advanceStep = useCallback(() => {
    stepIdxRef.current += 1;
    stepHoldRef.current = 0;
    stepStartAtRef.current = performance.now();

    const index = stepIdxRef.current;
    const total = stepsRef.current.length;
    setActiveChallengeIndex(Math.min(index, total));

    if (index < total) {
      setCurrentChallenge(stepsRef.current[index]?.label ?? "-");
      setProgressText(`${index} / ${total}`);
    } else {
      setCurrentChallenge("All done");
      setProgressText(`${total} / ${total}`);
      grantedRef.current = true;
    }
  }, []);

  const checkStep = useCallback(
    (measurement: StepMeasurement): ChallengeStatus => {
      const current = stepsRef.current[stepIdxRef.current];
      if (!current) return "pending";

      const thresholds = thresholdsRef.current;
      const now = performance.now();
      if (now - stepStartAtRef.current > thresholds.STEP_TIMEOUT_MS) {
        setLivenessInstruction("Challenge timed out. Skipping to next challenge.");
        return "failed";
      }

      if (current.id === "BLINK") {
        if (measurement.blinkEvent) {
          stepHoldRef.current = 1;
          return "passed";
        }
        stepHoldRef.current = 0;
        return "pending";
      }

      if (current.id === "WINK_LEFT") {
        const ok = measurement.bs.eyeBlinkLeft > 0.6 && measurement.bs.eyeBlinkRight < 0.35;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "WINK_RIGHT") {
        const ok = measurement.bs.eyeBlinkRight > 0.6 && measurement.bs.eyeBlinkLeft < 0.35;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "MOUTH") {
        const mouthOpen = Math.max(measurement.bs.mouthOpen, measurement.bs.jawOpen);
        const ok = measurement.MAR >= thresholds.MAR_OPEN || mouthOpen >= 0.5;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.MOUTH_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "SMILE") {
        const smile = (measurement.bs.mouthSmileLeft + measurement.bs.mouthSmileRight) / 2;
        const ok = smile >= 0.6;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "BROW_RAISE") {
        const brow = Math.max(
          measurement.bs.browInnerUp,
          measurement.bs.browOuterUpLeft,
          measurement.bs.browOuterUpRight
        );
        const ok = brow >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "JAW_LEFT") {
        const ok = measurement.bs.jawLeft >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "JAW_RIGHT") {
        const ok = measurement.bs.jawRight >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "EYE_LOOK_LEFT") {
        const left = Math.max(measurement.bs.eyeLookOutLeft, measurement.bs.eyeLookInRight);
        const ok = left >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "EYE_LOOK_RIGHT") {
        const right = Math.max(measurement.bs.eyeLookOutRight, measurement.bs.eyeLookInLeft);
        const ok = right >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "EYE_LOOK_UP") {
        const up = (measurement.bs.eyeLookUpLeft + measurement.bs.eyeLookUpRight) / 2;
        const ok = up >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "EYE_LOOK_DOWN") {
        const down = (measurement.bs.eyeLookDownLeft + measurement.bs.eyeLookDownRight) / 2;
        const ok = down >= 0.55;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.EXPRESSION_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "TURN_LEFT") {
        const yawTurnReq = Math.max(12, thresholds.YAW_TURN_DEG - 4);
        const poseHoldReq = Math.max(3, Math.floor(thresholds.POSE_HOLD_FR * 0.5));
        const ok = Math.abs(measurement.yawAdj) >= yawTurnReq;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= poseHoldReq ? "passed" : "pending";
      }

      if (current.id === "TURN_RIGHT") {
        const yawTurnReq = Math.max(12, thresholds.YAW_TURN_DEG - 4);
        const poseHoldReq = Math.max(3, Math.floor(thresholds.POSE_HOLD_FR * 0.5));
        const ok = Math.abs(measurement.yawAdj) >= yawTurnReq;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= poseHoldReq ? "passed" : "pending";
      }

      if (current.id === "LOOK_UP") {
        const positive = measurement.pitchAdj >= thresholds.PITCH_TURN_DEG;
        const negative = measurement.pitchAdj <= -thresholds.PITCH_TURN_DEG;
        let ok = false;
        let inferredUpSign: 1 | -1 | null = null;

        if (pitchUpSignRef.current === null) {
          if (positive || negative) {
            ok = true;
            inferredUpSign = positive ? 1 : -1;
          }
        } else {
          ok = pitchUpSignRef.current === 1 ? positive : negative;
        }

        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        if (stepHoldRef.current >= thresholds.POSE_HOLD_FR) {
          if (pitchUpSignRef.current === null && inferredUpSign !== null) {
            pitchUpSignRef.current = inferredUpSign;
          }
          return "passed";
        }
        return "pending";
      }

      if (current.id === "LOOK_DOWN") {
        const positive = measurement.pitchAdj >= thresholds.PITCH_TURN_DEG;
        const negative = measurement.pitchAdj <= -thresholds.PITCH_TURN_DEG;
        let ok = false;
        let inferredUpSign: 1 | -1 | null = null;

        if (pitchUpSignRef.current === null) {
          if (positive || negative) {
            ok = true;
            inferredUpSign = positive ? -1 : 1;
          }
        } else {
          ok = pitchUpSignRef.current === 1 ? negative : positive;
        }

        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        if (stepHoldRef.current >= thresholds.POSE_HOLD_FR) {
          if (pitchUpSignRef.current === null && inferredUpSign !== null) {
            pitchUpSignRef.current = inferredUpSign;
          }
          return "passed";
        }
        return "pending";
      }

      if (current.id === "TILT_LEFT") {
        const ok = measurement.rollDeg <= -thresholds.ROLL_TILT_DEG;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.POSE_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "TILT_RIGHT") {
        const ok = measurement.rollDeg >= thresholds.ROLL_TILT_DEG;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.POSE_HOLD_FR ? "passed" : "pending";
      }

      if (current.id === "HEAD_UP") {
        const ok = measurement.pitchAdj <= -thresholds.PITCH_UP_DEG;
        stepHoldRef.current = ok ? stepHoldRef.current + 1 : 0;
        return stepHoldRef.current >= thresholds.HEAD_HOLD_FR ? "passed" : "pending";
      }

      return "pending";
    },
    []
  );

  const sampleFaceBrightness = useCallback((): BrightnessSample | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }
    if (!alignedRef.current) {
      return null;
    }

    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement("canvas");
      analysisCanvasRef.current.width = 160;
      analysisCanvasRef.current.height = 120;
    }

    const canvas = analysisCanvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const width = canvas.width;
    const height = canvas.height;
    context.drawImage(video, 0, 0, width, height);

    const frame = context.getImageData(0, 0, width, height);
    const box = lastFaceBoxRef.current;
    if (!box) return null;

    let roiX = Math.floor((box.minX + box.w * 0.3) * width);
    let roiY = Math.floor((box.minY + box.h * 0.2) * height);
    let roiW = Math.floor(box.w * 0.4 * width);
    let roiH = Math.floor(box.h * 0.4 * height);

    roiX = Math.max(0, Math.min(width - 1, roiX));
    roiY = Math.max(0, Math.min(height - 1, roiY));
    roiW = Math.max(1, Math.min(width - roiX, roiW));
    roiH = Math.max(1, Math.min(height - roiY, roiH));

    let sum = 0;
    let count = 0;
    let saturated = 0;

    for (let y = 0; y < roiH; y += 1) {
      for (let x = 0; x < roiW; x += 1) {
        const index = ((roiY + y) * width + (roiX + x)) * 4;
        const red = frame.data[index];
        const green = frame.data[index + 1];
        const blue = frame.data[index + 2];
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        sum += luminance;
        if (luminance >= FLASH_OVEREXPOSED_Y) {
          saturated += 1;
        }
        count += 1;
      }
    }

    return count > 0
      ? {
          y: sum / count,
          saturatedRatio: saturated / count,
        }
      : null;
  }, []);

  const collectBrightnessSamples = useCallback(
    async (targetCount: number): Promise<BrightnessSample[]> => {
      const samples: BrightnessSample[] = [];

      for (let index = 0; index < targetCount; index += 1) {
        await waitForNextFrame();
        const sample = sampleFaceBrightness();
        if (sample) {
          samples.push(sample);
        }
        await wait(FLASH_FRAME_DELAY_MS);
      }

      return samples;
    },
    [sampleFaceBrightness]
  );

  const verifyProbeImage = useCallback(
    async (probeBlob: Blob): Promise<CoreFaceVerificationResult | null> => {
      setBusy("verify");
      setError(null);

      try {
        const result = await client.verifyFace({
          userId,
          probeImage: probeBlob,
          probeFileName: "face-probe.jpg",
        });
        const flashTest = buildOptionalFlashTestSummary(
          lastIlluminationMetricsRef.current,
          flashTestStatusRef.current,
          thresholdsRef.current
        );
        setVerifyResult({
          ...result,
          ...(flashTest ? { flashTest } : {}),
        });
        return result;
      } catch (requestError) {
        setError(formatSecureKitError(requestError, baseUrl));
        return null;
      } finally {
        setBusy("idle");
      }
    },
    [baseUrl, client, userId]
  );

  const finalizeLiveness = useCallback(
    async (localScore: number) => {
      if (finalizingRef.current) {
        return;
      }

      finalizingRef.current = true;
      setLivenessState("capturing");
      setCaptureSeriesText(null);
      setLivenessInstruction("Liveness checks completed. Capturing selfie series and verifying backend liveness...");

      try {
        let bestQuality = localScore;
        const outcome = await runFaceCaptureSeries({
          capture: async () => {
            const { blob, quality } = await readCapturedFrame();
            bestQuality = Math.max(bestQuality, quality);
            setProbeImage(blob);
            return blob;
          },
          verify: async (image, index) =>
            client.verifyFaceSlidingWindow({
              userId,
              probeImage: image,
              probeFileName: `liveness-selfie-${index}.jpg`,
              maxWindow: 3,
              updateOnSuccess: true,
            }),
          isSuccess: (verification) => verification.ok && verification.matched,
          onProgress: (progress) => {
            const text = captureSeriesStatusText(progress);
            setCaptureSeriesText(text);
            setLivenessInstruction(text);
          },
        });

        const selected = outcome.bestSuccess ?? outcome.bestAttempt;
        const flashTest = buildFlashTestSummary(
          lastIlluminationMetricsRef.current,
          flashTestStatusRef.current,
          thresholdsRef.current
        );
        if (selected?.image) {
          setProbeImage(selected.image);
        }
        if (selected?.result) {
          setVerifyResult({
            ...selected.result,
            flashTest,
          });
        }

        const backendPayloadQuality = clamp01(bestQuality);
        const illuminationMetrics =
          lastIlluminationMetricsRef.current ??
          (flashTestStatusRef.current === "failed" ? { illuminationOk: false } : {});

        const result = await client.verifyFaceLiveness({
          proof: { tasksOk: true },
          metrics: {
            quality: backendPayloadQuality,
            ...illuminationMetrics,
          },
        });

        setLivenessResult({
          ...result,
          details: {
            ...(result.details && typeof result.details === "object" ? result.details : {}),
            flashTest,
          },
        });

        const faceOk = Boolean(outcome.bestSuccess?.result);
        const overallOk = result.ok && localScore >= thresholdsRef.current.PAD_PASS && faceOk;
        setLivenessState(overallOk ? "done" : "failed");
        setLivenessInstruction(
          overallOk
            ? `Liveness success. Local PAD=${localScore.toFixed(2)}, backend=${result.score.toFixed(2)}, best face=${bestScoreText(outcome.bestSuccess?.result)}`
            : `Liveness failed. Local PAD=${localScore.toFixed(2)}, backend=${result.score.toFixed(2)}, best face=${bestScoreText(outcome.bestAttempt?.result)}`
        );

        if (!faceOk) {
          const bestScore = bestScoreText(outcome.bestAttempt?.result);
          const errorText = outcome.lastError
            ? formatSecureKitError(outcome.lastError, baseUrl)
            : `Face verification failed across ${outcome.attempts.length} captures.`;
          setError(`${errorText} Best score: ${bestScore}.`);
        }
      } catch (livenessError) {
        setLivenessState("failed");
        setError(formatSecureKitError(livenessError, baseUrl));
      } finally {
        finalizingRef.current = false;
      }
    },
    [baseUrl, client, readCapturedFrame, userId]
  );

  const runTick = useCallback(async (): Promise<void> => {
    if (!runningRef.current) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    const context = overlay.getContext("2d");
    if (!context) return;

    const now = performance.now();
    if (now - lastFrameTimeRef.current < MIN_FRAME_INTERVAL) {
      rafIdRef.current = window.requestAnimationFrame(() => {
        void runTick();
      });
      return;
    }

    lastFrameTimeRef.current = now;

    if (!video.videoWidth || video.readyState < 2) {
      rafIdRef.current = window.requestAnimationFrame(() => {
        void runTick();
      });
      return;
    }

    ensureOverlaySize();

    const result = await safeDetect(now);
    if (!runningRef.current) return;

    context.clearRect(0, 0, overlay.width, overlay.height);
    drawGuide(context, overlay.width, overlay.height, thresholdsRef.current.GUIDE);

    const currentStep = stepsRef.current[stepIdxRef.current];
    const relaxPose = currentStep ? isPoseChallenge(currentStep.id) : false;

    if (result?.faceLandmarks?.length) {
      const landmarks = result.faceLandmarks[0] as Array<{ x: number; y: number }>;
      const drawUtils = drawingUtilsRef.current;
      if (drawUtils && typeof drawUtils.drawLandmarks === "function") {
        try {
          drawUtils.drawLandmarks(landmarks, { color: "#00ff88", radius: 0.7 });
        } catch {
          // drawing is optional
        }
      }

      const pose = estimateYawPitch(landmarks);
      yawSmoothRef.current = ema(yawSmoothRef.current, pose.yawDeg, 0.3);
      pitchSmoothRef.current = ema(pitchSmoothRef.current, pose.pitchDeg, 0.3);
      const rollDeg = estimateRoll(landmarks);

      const yawSmooth = yawSmoothRef.current ?? 0;
      const pitchSmooth = pitchSmoothRef.current ?? 0;
      const box = faceBoxNorm(landmarks);
      lastFaceBoxRef.current = box;

      const earNow = computeEAR(landmarks);
      const marNow = computeMAR(landmarks);

      if (calibratingRef.current) {
        calSamplesRef.current.push({ EAR: earNow, MAR: marNow });
        yawHistRef.current.push(yawSmooth);
        pitchHistRef.current.push(pitchSmooth);

        if (calSamplesRef.current.length >= POSE_MED_FRAMES) {
          ear0Ref.current = median(calSamplesRef.current.map((item) => item.EAR));
          mar0Ref.current = median(calSamplesRef.current.map((item) => item.MAR));
          yaw0Ref.current = median(yawHistRef.current);
          pitch0Ref.current = median(pitchHistRef.current);

          thresholdsRef.current.EAR_CLOSE = Math.min(Math.max((ear0Ref.current ?? 0) * 0.72, 0.14), 0.28);
          thresholdsRef.current.EAR_OPEN = Math.min(Math.max((ear0Ref.current ?? 0) * 0.88, 0.2), 0.42);
          thresholdsRef.current.MAR_OPEN = Math.max((mar0Ref.current ?? 0) + 0.03, 0.1);

          calibratingRef.current = false;
          setLivenessInstruction(
            `Calibrated. EAR0=${(ear0Ref.current ?? 0).toFixed(3)}, MAR0=${(mar0Ref.current ?? 0).toFixed(3)}. Follow challenges.`
          );
        }
      }

      const yawAdj = yawSmooth - yaw0Ref.current;
      const pitchAdj = pitchSmooth - pitch0Ref.current;

      const alignment = evaluateAlignment(box, yawAdj, pitchAdj, relaxPose, thresholdsRef.current);
      alignedRef.current = alignment.ok;
      setAlignOk(alignment.ok);
      setAlignHint(alignment.hint);

      context.save();
      context.strokeStyle = alignment.ok ? "rgba(0,255,0,0.9)" : "rgba(255,80,0,0.9)";
      context.lineWidth = 2;
      context.strokeRect(
        box.minX * overlay.width,
        box.minY * overlay.height,
        box.w * overlay.width,
        box.h * overlay.height
      );
      context.restore();

      motionOkRef.current = updateMotion(landmarks[1]);

      const blinkEar = ear0Ref.current === null ? false : updateBlinkEAR(earNow);
      const categories = result.faceBlendshapes?.[0]?.categories ?? [];
      const blendshapes = buildBlendshapeScores(categories);

      const blinkScore = (blendshapes.eyeBlinkLeft + blendshapes.eyeBlinkRight) / 2;
      const blendshapeBlink = blinkScore > 0.6;
      const blinkEvent = blinkEar || blendshapeBlink;
      if (blinkEvent && !lastBlinkEventRef.current) {
        blinkCountRef.current = Math.min(blinkCountRef.current + 1, 5);
      }
      lastBlinkEventRef.current = blinkEvent;

      const neutralYawDeg = 8;
      const neutralPitchDeg = 8;
      const neutralRollDeg = 8;
      const faceNeutralForCapture =
        alignment.ok &&
        Math.abs(yawAdj) <= neutralYawDeg &&
        Math.abs(pitchAdj) <= neutralPitchDeg &&
        Math.abs(rollDeg) <= neutralRollDeg;
      const eyesOpenForCapture =
        earNow >= Math.max(0.18, thresholdsRef.current.EAR_OPEN * 0.92) &&
        blinkScore <= 0.45;
      const gazeHorizontal = Math.max(
        blendshapes.eyeLookOutLeft,
        blendshapes.eyeLookOutRight,
        blendshapes.eyeLookInLeft,
        blendshapes.eyeLookInRight
      );
      const gazeVertical = Math.max(
        blendshapes.eyeLookUpLeft,
        blendshapes.eyeLookUpRight,
        blendshapes.eyeLookDownLeft,
        blendshapes.eyeLookDownRight
      );
      const gazeCenteredForCapture = gazeHorizontal <= 0.45 && gazeVertical <= 0.4;
      const captureReady = faceNeutralForCapture && eyesOpenForCapture && gazeCenteredForCapture;
      neutralCaptureHoldRef.current = captureReady ? neutralCaptureHoldRef.current + 1 : 0;

      if (Math.abs(yawSmooth) >= thresholdsRef.current.YAW_REQ_DEG) {
        poseYawOkRef.current = true;
      }
      if (Math.abs(pitchSmooth) >= thresholdsRef.current.PITCH_REQ_DEG) {
        posePitchOkRef.current = true;
      }

      if (
        !grantedRef.current &&
        stepsRef.current.length > 0 &&
        ear0Ref.current !== null &&
        mar0Ref.current !== null
      ) {
        if (alignment.ok) {
          const stepStatus = checkStep({
            EAR: earNow,
            MAR: marNow,
            yawAdj,
            pitchAdj,
            rollDeg,
            bs: blendshapes,
            blinkEvent,
          });
          if (stepStatus === "passed" || stepStatus === "failed") {
            advanceStep();
          }
        } else {
          stepHoldRef.current = 0;
        }
      }

      if (showMetrics) {
        setDebugMetrics({
          ear: ear0Ref.current === null ? "-" : earNow.toFixed(3),
          earClose: thresholdsRef.current.EAR_CLOSE.toFixed(3),
          earOpen: thresholdsRef.current.EAR_OPEN.toFixed(3),
          mar: marNow.toFixed(3),
          marOpen: thresholdsRef.current.MAR_OPEN.toFixed(3),
          yaw: yawSmooth.toFixed(1),
          yawAdj: yawAdj.toFixed(1),
          pitch: pitchSmooth.toFixed(1),
          pitchAdj: pitchAdj.toFixed(1),
          roll: rollDeg.toFixed(1),
        });
      }
    } else {
      alignedRef.current = false;
      setAlignOk(false);
      setAlignHint("Hint: face not detected - ensure good lighting and unobstructed camera.");
      lastFaceBoxRef.current = null;
      lastBlinkEventRef.current = false;
      neutralCaptureHoldRef.current = 0;
    }

    const status = syncPadUi();
    if (status.readyToCapture && !finalizingRef.current) {
      const neutralReady = neutralCaptureHoldRef.current >= 5;
      if (neutralReady) {
        stopRenderLoop();
        setLivenessState("capturing");
        await finalizeLiveness(status.score);
        return;
      }
      if (livenessStateRef.current === "running") {
        setLivenessInstruction(
          "Challenges done. Keep your head straight, eyes open, and look directly at the camera for auto capture."
        );
      }
    }

    if (
      now - lastDetectOkAtRef.current > STALL_TIMEOUT &&
      !usingCPURef.current &&
      landmarkerRef.current
    ) {
      try {
        landmarkerRef.current = await createLandmarker("CPU");
        usingCPURef.current = true;
        lastDetectOkAtRef.current = performance.now();
      } catch {
        // keep current model if fallback fails
      }
    }

    if (runningRef.current) {
      rafIdRef.current = window.requestAnimationFrame(() => {
        void runTick();
      });
    }
  }, [advanceStep, checkStep, createLandmarker, ensureOverlaySize, finalizeLiveness, safeDetect, showMetrics, stopRenderLoop, syncPadUi, updateBlinkEAR, updateMotion]);

  const startLiveness = useCallback(async () => {
    if (!cameraActive) {
      setError("Please start camera first.");
      return;
    }
    if (!videoRef.current?.srcObject) {
      setError("Camera stream is not ready.");
      return;
    }

    setError(null);
    stopRenderLoop();
    resetRuntime();
    setLivenessState("running");

    try {
      await loadLandmarker();
      startChallenges();
      runningRef.current = true;
      lastFrameTimeRef.current = 0;
      rafIdRef.current = window.requestAnimationFrame(() => {
        void runTick();
      });
    } catch (livenessError) {
      setLivenessState("failed");
      setError(formatSecureKitError(livenessError, baseUrl));
    }
  }, [baseUrl, cameraActive, loadLandmarker, resetRuntime, runTick, startChallenges, stopRenderLoop]);

  const runFlashTest = useCallback(async () => {
    if (livenessStateRef.current !== "running") {
      setError("Flash test can run only while liveness is running.");
      return;
    }
    if (flashTestInProgressRef.current) {
      return;
    }

    const flashEl = flashRef.current;
    if (!flashEl) {
      setError("Flash layer is not ready.");
      return;
    }

    setError(null);
    flashTestInProgressRef.current = true;
    flashOkRef.current = false;
    lastIlluminationMetricsRef.current = null;
    setFlashMetrics(null);
    setFlashStatus("waiting");
    syncPadUi();
    setLivenessInstruction("Illumination flash in 1 second. Keep your face steady.");

    const originalStyle = {
      position: flashEl.style.position,
      inset: flashEl.style.inset,
      zIndex: flashEl.style.zIndex,
      background: flashEl.style.background,
      opacity: flashEl.style.opacity,
      transition: flashEl.style.transition,
      pointerEvents: flashEl.style.pointerEvents,
    };

    Object.assign(flashEl.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "#fff",
      opacity: "0",
      transition: "opacity 0.08s linear",
      pointerEvents: "none",
    });

    let shouldCaptureAfterFlash = false;

    try {
      await wait(1000);

      setFlashStatus("sampling");
      setLivenessInstruction("Measuring baseline brightness. Keep your face centered.");
      const baselineSamples = await collectBrightnessSamples(FLASH_SAMPLE_FRAMES);

      setLivenessInstruction("Screen flash active. Keep your face steady.");
      flashEl.style.opacity = "1";
      await wait(80);
      const flashSamples = await collectBrightnessSamples(FLASH_SAMPLE_FRAMES);

      setLivenessInstruction("Measuring recovery brightness.");
      flashEl.style.opacity = "0";
      await wait(80);
      const recoverySamples = await collectBrightnessSamples(FLASH_SAMPLE_FRAMES);
      shouldCaptureAfterFlash = true;

      const sampleCount = baselineSamples.length + flashSamples.length + recoverySamples.length;
      const hasEnoughSamples =
        baselineSamples.length >= FLASH_SAMPLE_FRAMES &&
        flashSamples.length >= FLASH_SAMPLE_FRAMES &&
        recoverySamples.length >= FLASH_SAMPLE_FRAMES;

      if (!hasEnoughSamples) {
        setFlashStatus("failed");
        setLivenessInstruction(
          `Flash sampling failed (${sampleCount}/15 frames). Capturing selfie in ${FLASH_CAPTURE_DELAY_MS}ms.`
        );
        return;
      }

      const allSamples = [...baselineSamples, ...flashSamples, ...recoverySamples];
      const baselineY = medianBrightness(baselineSamples);
      const flashY = medianBrightness(flashSamples);
      const recoveryY = medianBrightness(recoverySamples);
      const deltaY = flashY - baselineY;
      const relativeDelta = deltaY / Math.max(baselineY, 1);
      const saturatedRatio = maxSaturatedRatio(allSamples);
      const overexposed =
        baselineY >= FLASH_OVEREXPOSED_Y ||
        flashY >= FLASH_OVEREXPOSED_Y ||
        saturatedRatio > FLASH_SATURATED_RATIO_MAX;

      const illuminationOk =
        !overexposed &&
        deltaY >= thresholdsRef.current.FLASH_DELTA_MIN &&
        relativeDelta >= FLASH_RELATIVE_DELTA_MIN;

      const metrics: IlluminationMetrics = {
        illuminationOk,
        baselineY,
        flashY,
        recoveryY,
        deltaY,
        relativeDelta,
        sampleCount,
        saturatedRatio,
      };

      lastIlluminationMetricsRef.current = metrics;
      setFlashMetrics(metrics);
      flashOkRef.current = illuminationOk;
      setFlashStatus(illuminationOk ? "passed" : "failed");

      if (overexposed) {
        setLivenessInstruction(
          `Flash sample overexposed (Y=${flashY.toFixed(1)}, sat=${(saturatedRatio * 100).toFixed(0)}%). Capturing selfie in ${FLASH_CAPTURE_DELAY_MS}ms.`
        );
      } else {
        setLivenessInstruction(
          illuminationOk
            ? `Flash response OK (delta=${deltaY.toFixed(1)}, relative=${(relativeDelta * 100).toFixed(0)}%). Capturing selfie in ${FLASH_CAPTURE_DELAY_MS}ms.`
            : `Flash response weak (delta=${deltaY.toFixed(1)}, relative=${(relativeDelta * 100).toFixed(0)}%). Capturing selfie in ${FLASH_CAPTURE_DELAY_MS}ms.`
        );
      }
    } finally {
      Object.assign(flashEl.style, originalStyle);
      flashTestInProgressRef.current = false;
      const status = syncPadUi();

      if (shouldCaptureAfterFlash && !finalizingRef.current) {
        await wait(FLASH_CAPTURE_DELAY_MS);
        if (finalizingRef.current || livenessStateRef.current !== "running") {
          return;
        }
        stopRenderLoop();
        setLivenessState("capturing");
        await finalizeLiveness(status.score);
      }
    }
  }, [collectBrightnessSamples, finalizeLiveness, setFlashStatus, stopRenderLoop, syncPadUi]);

  useEffect(() => {
    const challengesCompleted =
      challengePlan.length > 0 && activeChallengeIndex >= challengePlan.length;
    const canAutoStart =
      livenessState === "running" &&
      challengesCompleted &&
      !checks.flash &&
      flashTestStatus === "idle" &&
      !flashAutoStartedRef.current;

    if (!canAutoStart) {
      return;
    }

    flashAutoStartedRef.current = true;
    setLivenessInstruction("Challenges done. Flash test will start automatically.");
    const timerId = window.setTimeout(() => {
      void runFlashTest();
    }, 450);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [activeChallengeIndex, challengePlan.length, checks.flash, flashTestStatus, livenessState, runFlashTest]);

  const captureSelfie = useCallback(async () => {
    try {
      const { blob } = await readCapturedFrame();
      setProbeImage(blob);
      setError(null);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Failed to capture selfie image.");
    }
  }, [readCapturedFrame]);

  const runEnrollFaceReference = useCallback(async () => {
    if (!probeImage) {
      setError("Capture or upload a face reference selfie first.");
      return;
    }

    setBusy("enroll");
    setError(null);

    try {
      const response = await client.enrollFaceReference({
        userId,
        referenceImage: probeImage,
        referenceFileName: "face-reference.jpg",
      });
      setEnrollReferenceResult(response);
      setProfileStatus({
        state: "registered",
        imagePath: response.reference.imagePath,
        enrolledAt: response.reference.enrolledAt,
        legacy: false,
        error: null,
      });
    } catch (enrollError) {
      setError(formatSecureKitError(enrollError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client, probeImage, userId]);

  const runVerifyWithStoredReference = useCallback(async () => {
    if (!probeImage) {
      setError("Capture or upload a probe selfie first.");
      return;
    }
    await verifyProbeImage(probeImage);
  }, [probeImage, verifyProbeImage]);

  const livenessBusy = livenessState === "running" || livenessState === "capturing";
  const userControlsDisabled = busy !== "idle" || addingUser || livenessBusy;
  const addUserDisabled = userControlsDisabled || !newUserId.trim();
  const actionDisabled = busy !== "idle" || livenessBusy;
  const busyText =
    busy === "enroll"
      ? "Saving face reference..."
      : busy === "verify"
        ? "Verifying..."
        : livenessState === "capturing"
          ? "Liveness: Capturing..."
          : null;

  return (
    <section style={{ padding: 16, border: "1px solid #d0d5dd", borderRadius: 10, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Face Verification</h2>
      <p>
        API Base: <code>{baseUrl}</code>
      </p>
      <p>
        Manual verification uses the selected user's saved face reference. Liveness verification updates
        the user's 3-photo sliding window after successful face matching.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Kisi</span>
          <select
            style={{ display: "block", width: "100%" }}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={userControlsDisabled}
          >
            {faceUsers.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Probe selfie (upload)</span>
          <input
            style={{ display: "block", width: "100%" }}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={actionDisabled}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setProbeImage(file);
            }}
          />
        </label>

        <div style={COMPACT_PANEL_STYLE}>
          <div>
            <b>Yuz referansi</b>
          </div>
          <div style={faceStatusStyle(profileStatus)}>{faceStatusLabel(profileStatus)}</div>
          <div>{faceStatusDetail(profileStatus)}</div>
        </div>
      </div>

      <form
        onSubmit={(event) => void handleAddFaceUser(event)}
        style={{
          marginTop: 12,
          display: "grid",
          gap: 10,
          padding: 12,
          borderRadius: 10,
          border: "1px solid #d0d5dd",
          background: "#f8fafc",
        }}
      >
        <div>
          <b>Yeni kisi</b>
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Kullanici ID</span>
            <input
              value={newUserId}
              onChange={(event) => setNewUserId(event.target.value)}
              placeholder="ayse"
              autoComplete="username"
              disabled={userControlsDisabled}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="submit" disabled={addUserDisabled}>
              {addingUser ? "Ekleniyor..." : "Secime ekle"}
            </button>
          </div>
        </div>
        {addUserMessage && <div style={{ color: "#166534", fontWeight: 600 }}>{addUserMessage}</div>}
        {userListError && <div style={{ color: "#92400e" }}>Kisi listesi okunamadi.</div>}
      </form>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={runVerifyWithStoredReference} disabled={actionDisabled}>
          Verify (Face Reference)
        </button>
        <button onClick={() => void runEnrollFaceReference()} disabled={actionDisabled || !probeImage}>
          Yuz referansi kaydet
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!cameraActive ? (
          <button onClick={() => void startCamera()} disabled={busy !== "idle" || addingUser}>
            Start Camera
          </button>
        ) : (
          <>
            <button onClick={() => void captureSelfie()} disabled={actionDisabled}>
              Capture Selfie
            </button>
            <button onClick={() => void startLiveness()} disabled={actionDisabled}>
              Start Liveness
            </button>
            <button
              onClick={() => void runFlashTest()}
              disabled={livenessState !== "running" || flashTestStatus === "waiting" || flashTestStatus === "sampling"}
            >
              {flashTestStatus === "waiting" || flashTestStatus === "sampling" ? "Flash Test Running..." : "Run Flash Test"}
            </button>
            <button onClick={() => setShowMetrics((current) => !current)}>
              {showMetrics ? "Hide Metrics" : "Show Metrics"}
            </button>
            <button onClick={stopCamera}>Stop Camera</button>
          </>
        )}
      </div>

      {enrollReferenceResult && (
        <p style={{ color: "#166534", fontWeight: 600 }}>
          Yuz referansi kaydedildi: <code>{enrollReferenceResult.reference.enrolledAt}</code>
        </p>
      )}

      {(livenessState !== "idle" || livenessResult) && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: "1px solid #d0d5dd",
            borderRadius: 8,
            background: "#f8fafc",
          }}
        >
          <strong>Liveness</strong>
          <p style={{ margin: "8px 0 0" }}>
            <b>Instruction:</b> {livenessInstruction}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Alignment:</b>{" "}
            <span
              style={{
                display: "inline-block",
                marginLeft: 6,
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 12,
                border: alignOk ? "1px solid #9ae6b4" : "1px solid #fbd38d",
                background: alignOk ? "#e6ffed" : "#fff7e6",
                color: alignOk ? "#067d1f" : "#a15c00",
              }}
            >
              {alignOk ? "Aligned" : "Not aligned"}
            </span>
          </p>
          {alignHint && <p style={{ margin: "6px 0 0", color: "#a15c00" }}>{alignHint}</p>}
          <p style={{ margin: "6px 0 0" }}>
            <b>Current challenge:</b> {currentChallenge}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Progress:</b> {progressText}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Flash testi:</b>{" "}
            <span style={flashStatusStyle(flashTestStatus)}>{flashStatusText(flashTestStatus)}</span>
          </p>
          {flashMetrics && (
            <p style={{ margin: "6px 0 0", color: "#475467" }}>
              Delta: {flashMetrics.deltaY.toFixed(1)} Y, relative:{" "}
              {(flashMetrics.relativeDelta * 100).toFixed(0)}%, samples: {flashMetrics.sampleCount}/15
            </p>
          )}
          <p style={{ margin: "6px 0 0" }}>
            <b>PAD score:</b> {padScore.toFixed(2)} / 1.00
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Result:</b> {padResult}
          </p>

          <ul style={{ margin: "8px 0 0", lineHeight: 1.7 }}>
            <li>Eye Blink: {checks.blink ? "OK" : "X"}</li>
            <li>Head Pose (Yaw/Pitch): {checks.pose ? "OK" : "X"}</li>
            <li>Micro-motion: {checks.motion ? "OK" : "X"}</li>
            <li>Illumination Response: {checks.flash ? "OK" : "X"}</li>
          </ul>

          {livenessResult && (
            <p style={{ margin: "6px 0 0" }}>
              Backend liveness score: {livenessResult.score.toFixed(2)} ({livenessResult.ok ? "passed" : "failed"})
            </p>
          )}
          {captureSeriesText && (
            <p style={{ margin: "6px 0 0", color: "#475467" }}>
              <b>Capture series:</b> {captureSeriesText}
            </p>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Camera</h4>
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 640,
              aspectRatio: "4 / 3",
              background: "#111",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <video
              ref={videoRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              muted
              playsInline
            />
            <canvas
              ref={overlayRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            />
            <div
              ref={flashRef}
              style={{
                position: "absolute",
                inset: 0,
                background: "#fff",
                opacity: 0,
                transition: "opacity 0.15s",
                pointerEvents: "none",
              }}
            />
            {challengePlan.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  right: 8,
                  zIndex: 3,
                  pointerEvents: "none",
                  color: "#f8fafc",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "linear-gradient(180deg, rgba(10,13,18,0.82) 0%, rgba(10,13,18,0.64) 100%)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <strong style={{ fontSize: 13 }}>Current challenge</strong>
                <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, lineHeight: 1.35, wordBreak: "break-word" }}>
                  {activeChallengeIndex >= challengePlan.length
                    ? "All challenges completed"
                    : challengePlan[activeChallengeIndex]?.label ?? currentChallenge}
                </div>
              </div>
            )}
            {showMetrics && (
              <div
                style={{
                  position: "absolute",
                  left: 8,
                  bottom: 8,
                  color: "#ddd",
                  font: "12px/1.4 monospace",
                  background: "rgba(0,0,0,0.35)",
                  padding: "6px 8px",
                  borderRadius: 6,
                }}
              >
                EAR:{debugMetrics.ear} (CL:{debugMetrics.earClose}/OP:{debugMetrics.earOpen}) | MAR:{debugMetrics.mar} (OPEN_TH:{debugMetrics.marOpen})<br />
                yaw:{debugMetrics.yaw} (adj:{debugMetrics.yawAdj}) | pitch:{debugMetrics.pitch} (adj:{debugMetrics.pitchAdj}) | roll:{debugMetrics.roll}
              </div>
            )}
          </div>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px" }}>Probe Preview</h4>
          {probePreviewUrl ? (
            <div style={PREVIEW_FRAME_STYLE}>
              <img
                src={probePreviewUrl}
                alt="Probe preview"
                style={PREVIEW_IMAGE_STYLE}
              />
            </div>
          ) : (
            <div style={PREVIEW_EMPTY_STYLE}>No selfie selected.</div>
          )}
        </div>
      </div>

      {busyText && <p>{busyText}</p>}
      {error && <p style={{ color: "#b42318" }}>Error: {error}</p>}

      {verifyResult && (
        <details style={{ marginTop: 12 }} open>
          <summary>Verification response</summary>
          <pre>{pretty(verifyResult)}</pre>
        </details>
      )}
    </section>
  );
};
