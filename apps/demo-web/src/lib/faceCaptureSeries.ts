import type { FaceSlidingWindowVerificationResult } from "@securekit/core";

export const FACE_CAPTURE_SERIES_COUNT = 3;
export const FACE_CAPTURE_SERIES_INTERVAL_MS = 1000;

export type FaceSeriesProgressPhase = "capture" | "verify" | "wait";

export type FaceSeriesAttempt = {
  index: number;
  total: number;
  image: Blob | null;
  result: FaceSlidingWindowVerificationResult | null;
  error: unknown;
};

export type FaceSeriesOutcome = {
  attempts: FaceSeriesAttempt[];
  bestSuccess: FaceSeriesAttempt | null;
  bestAttempt: FaceSeriesAttempt | null;
  lastError: unknown;
};

export type FaceSeriesProgress = {
  phase: FaceSeriesProgressPhase;
  index: number;
  total: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function scoreOf(result: FaceSlidingWindowVerificationResult | null): number {
  return typeof result?.score === "number" ? result.score : Number.NEGATIVE_INFINITY;
}

function betterAttempt(
  current: FaceSeriesAttempt | null,
  candidate: FaceSeriesAttempt
): FaceSeriesAttempt {
  if (!current) return candidate;
  return scoreOf(candidate.result) > scoreOf(current.result) ? candidate : current;
}

export async function captureVideoFrame(video: HTMLVideoElement | null): Promise<Blob> {
  if (!video || !video.videoWidth || !video.videoHeight) {
    throw new Error("Camera frame is not ready.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not capture image from camera.");
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });

  if (!blob) {
    throw new Error("Could not create captured image file.");
  }

  return blob;
}

export async function runFaceCaptureSeries(args: {
  capture: () => Promise<Blob>;
  verify: (image: Blob, index: number) => Promise<FaceSlidingWindowVerificationResult>;
  isSuccess: (result: FaceSlidingWindowVerificationResult) => boolean;
  count?: number;
  intervalMs?: number;
  onProgress?: (progress: FaceSeriesProgress) => void;
}): Promise<FaceSeriesOutcome> {
  const total = args.count ?? FACE_CAPTURE_SERIES_COUNT;
  const intervalMs = args.intervalMs ?? FACE_CAPTURE_SERIES_INTERVAL_MS;
  const attempts: FaceSeriesAttempt[] = [];
  let bestSuccess: FaceSeriesAttempt | null = null;
  let bestAttempt: FaceSeriesAttempt | null = null;
  let lastError: unknown = null;

  for (let index = 1; index <= total; index += 1) {
    let image: Blob | null = null;
    let result: FaceSlidingWindowVerificationResult | null = null;
    let error: unknown = null;

    try {
      args.onProgress?.({ phase: "capture", index, total });
      image = await args.capture();

      args.onProgress?.({ phase: "verify", index, total });
      result = await args.verify(image, index);
    } catch (attemptError) {
      error = attemptError;
      lastError = attemptError;
    }

    const attempt: FaceSeriesAttempt = { index, total, image, result, error };
    attempts.push(attempt);

    if (result) {
      bestAttempt = betterAttempt(bestAttempt, attempt);
      if (args.isSuccess(result)) {
        bestSuccess = betterAttempt(bestSuccess, attempt);
      }
    }

    if (index < total) {
      args.onProgress?.({ phase: "wait", index, total });
      await wait(intervalMs);
    }
  }

  return { attempts, bestSuccess, bestAttempt, lastError };
}
