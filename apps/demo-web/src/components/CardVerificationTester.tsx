import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardReferenceSummary, CardVerificationResult } from "@securekit/web-sdk";
import {
  formatSecureKitError,
  getSecureKitClient,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";

type BusyState = "idle" | "loading" | "verifying";
type CaptureState = "idle" | "watching" | "capturing";

type CardReference = CardReferenceSummary;
type CardVerificationResponse = CardVerificationResult;

type GuideRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type StageSize = {
  width: number;
  height: number;
};

type CardPresenceMetrics = {
  detected: boolean;
  cardScore: number;
  detailScore: number;
  contrastScore: number;
  borderScore: number;
  fillScore: number;
  aspectScore: number;
};

const AUTO_CAPTURE_DELAY_MS = 500;
const STAGE_ASPECT_RATIO = 4 / 3;
const GUIDE_ASPECT_RATIO = 1.58;
const GUIDE_MAX_WIDTH_RATIO = 0.78;
const GUIDE_MAX_HEIGHT_RATIO = 0.54;
const GUIDE_WIDTH_RATIO = Math.min(
  GUIDE_MAX_WIDTH_RATIO,
  (GUIDE_MAX_HEIGHT_RATIO / STAGE_ASPECT_RATIO) * GUIDE_ASPECT_RATIO
);
const CAPTURE_OVERSCAN_RATIO = 0;
const CARD_ANALYSIS_INTERVAL_MS = 140;
const CARD_ANALYSIS_WIDTH = 160;
const CARD_ANALYSIS_HEIGHT = Math.round(CARD_ANALYSIS_WIDTH / GUIDE_ASPECT_RATIO);
const CARD_DETECTION_HOLD_FRAMES = 4;
const CARD_DETECTION_THRESHOLD = 0.62;

const MEDIA_GRID_STYLE: React.CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
  alignItems: "start",
};

const MEDIA_PANEL_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: 640,
  margin: "0 auto",
};

const CAMERA_STAGE_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "4 / 3",
  background: "#111827",
  borderRadius: 10,
  overflow: "hidden",
};

const CAPTURE_STAGE_STYLE: React.CSSProperties = {
  ...CAMERA_STAGE_STYLE,
  border: "1px solid #d0d5dd",
  background: "linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%)",
};

const CAPTURE_CARD_WINDOW_STYLE: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: `${GUIDE_WIDTH_RATIO * 100}%`,
  aspectRatio: `${GUIDE_ASPECT_RATIO}`,
  transform: "translate(-50%, -50%)",
  borderRadius: 4,
  overflow: "hidden",
  boxSizing: "border-box",
};

const PREVIEW_IMAGE_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "contain",
  objectPosition: "center",
};
const PREVIEW_EMPTY_STYLE: React.CSSProperties = {
  ...CAPTURE_CARD_WINDOW_STYLE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 12,
  border: "1px dashed #d0d5dd",
  background: "#ffffff",
  color: "#475467",
  fontSize: 14,
  textAlign: "center",
};

function toPreviewUrl(file: Blob | null): string | null {
  if (!file) return null;
  return URL.createObjectURL(file);
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toOptionalPercent(value: number | null | undefined): string {
  return typeof value === "number" ? toPercent(value) : "-";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getGuideRect(width: number, height: number): GuideRect {
  const maxWidth = width * GUIDE_MAX_WIDTH_RATIO;
  const maxHeight = height * GUIDE_MAX_HEIGHT_RATIO;
  const widthFromHeight = maxHeight * GUIDE_ASPECT_RATIO;
  const guideWidth = Math.min(maxWidth, widthFromHeight);
  const guideHeight = guideWidth / GUIDE_ASPECT_RATIO;

  return {
    x: (width - guideWidth) / 2,
    y: (height - guideHeight) / 2,
    w: guideWidth,
    h: guideHeight,
  };
}

function getOverlaySize(overlay: HTMLCanvasElement | null): StageSize {
  const bounds = overlay?.getBoundingClientRect();
  const width = Math.round(bounds?.width || overlay?.clientWidth || 640);
  const height = Math.round(bounds?.height || overlay?.clientHeight || width / STAGE_ASPECT_RATIO);

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function addGuideOverscan(rect: GuideRect, boundsWidth: number, boundsHeight: number): GuideRect {
  const paddingX = rect.w * CAPTURE_OVERSCAN_RATIO;
  const paddingY = rect.h * CAPTURE_OVERSCAN_RATIO;
  const x = Math.max(0, rect.x - paddingX);
  const y = Math.max(0, rect.y - paddingY);
  const right = Math.min(boundsWidth, rect.x + rect.w + paddingX);
  const bottom = Math.min(boundsHeight, rect.y + rect.h + paddingY);

  return {
    x,
    y,
    w: right - x,
    h: bottom - y,
  };
}

function mapCoverRectToVideo(
  rect: GuideRect,
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number
): GuideRect {
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (displayWidth - renderedWidth) / 2;
  const offsetY = (displayHeight - renderedHeight) / 2;

  const left = clamp((rect.x - offsetX) / scale, 0, videoWidth);
  const top = clamp((rect.y - offsetY) / scale, 0, videoHeight);
  const right = clamp((rect.x + rect.w - offsetX) / scale, 0, videoWidth);
  const bottom = clamp((rect.y + rect.h - offsetY) / scale, 0, videoHeight);

  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

function getGuideSourceRect(video: HTMLVideoElement, displaySize: StageSize): GuideRect {
  const displayedGuide = addGuideOverscan(
    getGuideRect(displaySize.width, displaySize.height),
    displaySize.width,
    displaySize.height
  );

  return mapCoverRectToVideo(
    displayedGuide,
    video.videoWidth,
    video.videoHeight,
    displaySize.width,
    displaySize.height
  );
}

function getCardLabel(reference: CardReference | null): string {
  return reference?.label?.trim() || reference?.fileName || "selected card";
}

function getIdleGuideMessage(): string {
  return "Select a card, start the camera, then capture when you're ready.";
}

function getReadyGuideMessage(cardLabel: string): string {
  return `${cardLabel} selected. You can capture now, or start auto capture.`;
}

function getWaitingGuideMessage(cardLabel: string): string {
  return `Place ${cardLabel} inside the box if you want auto capture.`;
}

function findPeak(values: Float32Array, startRatio: number, endRatio: number): {
  index: number;
  score: number;
} {
  if (values.length === 0) {
    return { index: 0, score: 0 };
  }

  const start = Math.max(0, Math.min(values.length - 1, Math.floor(values.length * startRatio)));
  const end = Math.max(start + 1, Math.min(values.length, Math.ceil(values.length * endRatio)));

  let bestIndex = start;
  let bestScore = -Infinity;

  for (let index = start; index < end; index += 1) {
    const prev = values[Math.max(0, index - 1)] ?? 0;
    const current = values[index] ?? 0;
    const next = values[Math.min(values.length - 1, index + 1)] ?? 0;
    const smoothed = (prev + current + next) / 3;

    if (smoothed > bestScore) {
      bestScore = smoothed;
      bestIndex = index;
    }
  }

  return {
    index: bestIndex,
    score: Number.isFinite(bestScore) ? bestScore : 0,
  };
}

function analyzeGuideForCard(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  displaySize: StageSize
): CardPresenceMetrics | null {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return null;
  }

  canvas.width = CARD_ANALYSIS_WIDTH;
  canvas.height = CARD_ANALYSIS_HEIGHT;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  const guide = getGuideSourceRect(video, displaySize);
  context.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, canvas.width, canvas.height);

  const width = canvas.width;
  const height = canvas.height;
  const pixels = context.getImageData(0, 0, width, height).data;
  const grayscale = new Float32Array(width * height);
  const verticalEdges = new Float32Array(width);
  const horizontalEdges = new Float32Array(height);

  let brightnessTotal = 0;
  let brightnessSquareTotal = 0;
  let edgeTotal = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const gray =
        (0.299 * pixels[pixelIndex] +
          0.587 * pixels[pixelIndex + 1] +
          0.114 * pixels[pixelIndex + 2]) /
        255;
      const grayIndex = y * width + x;
      grayscale[grayIndex] = gray;
      brightnessTotal += gray;
      brightnessSquareTotal += gray * gray;

      if (x > 0) {
        const diff = Math.abs(gray - grayscale[grayIndex - 1]);
        edgeTotal += diff;
        verticalEdges[x] += diff;
      }

      if (y > 0) {
        const diff = Math.abs(gray - grayscale[grayIndex - width]);
        edgeTotal += diff;
        horizontalEdges[y] += diff;
      }
    }
  }

  const pixelCount = width * height;
  const averageBrightness = brightnessTotal / pixelCount;
  const variance = Math.max(0, brightnessSquareTotal / pixelCount - averageBrightness ** 2);
  const detailScore = clamp01(edgeTotal / (pixelCount * 2 * 0.08));
  const contrastScore = clamp01(Math.sqrt(variance) / 0.18);

  const leftPeak = findPeak(verticalEdges, 0.05, 0.35);
  const rightPeak = findPeak(verticalEdges, 0.65, 0.95);
  const topPeak = findPeak(horizontalEdges, 0.05, 0.35);
  const bottomPeak = findPeak(horizontalEdges, 0.65, 0.95);

  const borderStrength =
    leftPeak.score / height +
    rightPeak.score / height +
    topPeak.score / width +
    bottomPeak.score / width;
  const borderScore = clamp01((borderStrength / 4) / 0.16);

  const rectWidth = Math.max(1, rightPeak.index - leftPeak.index);
  const rectHeight = Math.max(1, bottomPeak.index - topPeak.index);
  const fillWidth = rectWidth / width;
  const fillHeight = rectHeight / height;
  const fillScore = clamp01(
    (1 - Math.min(Math.abs(fillWidth - 0.78) / 0.22, 1) +
      1 - Math.min(Math.abs(fillHeight - 0.78) / 0.22, 1)) /
      2
  );

  const aspectRatio = rectWidth / rectHeight;
  const aspectScore = clamp01(1 - Math.min(Math.abs(aspectRatio - GUIDE_ASPECT_RATIO) / 0.45, 1));

  const cardScore = clamp01(
    0.28 * detailScore +
      0.18 * contrastScore +
      0.28 * borderScore +
      0.14 * fillScore +
      0.12 * aspectScore
  );

  return {
    detected:
      cardScore >= CARD_DETECTION_THRESHOLD &&
      borderScore >= 0.45 &&
      fillScore >= 0.45 &&
      aspectScore >= 0.55 &&
      detailScore >= 0.35,
    cardScore,
    detailScore,
    contrastScore,
    borderScore,
    fillScore,
    aspectScore,
  };
}

function drawGuide(canvas: HTMLCanvasElement, message: string): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width || 640;
  const height = canvas.height || 480;
  const guide = getGuideRect(width, height);

  context.clearRect(0, 0, width, height);
  context.save();
  context.fillStyle = "rgba(15, 23, 42, 0.2)";
  context.fillRect(0, 0, width, height);
  context.clearRect(guide.x, guide.y, guide.w, guide.h);
  context.strokeStyle = "#22c55e";
  context.lineWidth = 3;
  context.strokeRect(guide.x, guide.y, guide.w, guide.h);

  const badgeWidth = Math.min(width - 20, Math.max(260, guide.w * 0.72));
  const badgeHeight = 54;
  const badgeX = (width - badgeWidth) / 2;
  const badgeY = Math.max(12, guide.y - 70);

  context.fillStyle = "rgba(15, 23, 42, 0.82)";
  context.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
  context.fillStyle = "#e2e8f0";
  context.font = "600 14px Sora, sans-serif";
  context.fillText("Card capture", badgeX + 14, badgeY + 20);
  context.font = "400 13px Sora, sans-serif";
  context.fillText(message, badgeX + 14, badgeY + 40, badgeWidth - 28);
  context.restore();
}

export const CardVerificationTester: React.FC = () => {
  const baseUrl = useMemo(() => resolveSecureKitBaseUrl(), []);
  const client = useMemo(() => getSecureKitClient(), []);

  const [references, setReferences] = useState<CardReference[]>([]);
  const [referenceDir, setReferenceDir] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState("");
  const [capturedCard, setCapturedCard] = useState<Blob | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [guideMessage, setGuideMessage] = useState(getIdleGuideMessage);
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<CardVerificationResponse | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoCaptureTimeoutRef = useRef<number | null>(null);
  const detectionFrameRef = useRef<number | null>(null);
  const lastAnalysisAtRef = useRef(0);
  const detectionHoldFramesRef = useRef(0);
  const selectedReferenceRef = useRef<CardReference | null>(null);
  const selectedReferenceIdRef = useRef("");
  const selectedCardLabelRef = useRef("selected card");
  const guideMessageRef = useRef(getIdleGuideMessage());

  const selectedReference = useMemo(
    () =>
      references.find((reference) => reference.id === selectedReferenceId) ??
      references[0] ??
      null,
    [references, selectedReferenceId]
  );
  const selectedCardLabel = getCardLabel(selectedReference);

  useEffect(() => {
    selectedReferenceRef.current = selectedReference;
    selectedReferenceIdRef.current = selectedReference?.id ?? "";
    selectedCardLabelRef.current = selectedCardLabel;
  }, [selectedCardLabel, selectedReference]);

  useEffect(() => {
    if (references.length === 0) {
      if (selectedReferenceId !== "") {
        setSelectedReferenceId("");
      }
      return;
    }

    if (!references.some((reference) => reference.id === selectedReferenceId)) {
      setSelectedReferenceId(references[0]?.id ?? "");
    }
  }, [references, selectedReferenceId]);

  useEffect(() => {
    const nextUrl = toPreviewUrl(capturedCard);
    setCapturedPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
  }, [capturedCard]);

  const clearAutoCaptureTimeout = useCallback(() => {
    if (autoCaptureTimeoutRef.current !== null) {
      window.clearTimeout(autoCaptureTimeoutRef.current);
      autoCaptureTimeoutRef.current = null;
    }
  }, []);

  const stopDetectionLoop = useCallback(() => {
    if (detectionFrameRef.current !== null) {
      window.cancelAnimationFrame(detectionFrameRef.current);
      detectionFrameRef.current = null;
    }

    lastAnalysisAtRef.current = 0;
    detectionHoldFramesRef.current = 0;
  }, []);

  const renderGuide = useCallback(
    (message = guideMessageRef.current) => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay) return;

      const { width, height } = getOverlaySize(overlay);
      if (overlay.width !== width || overlay.height !== height) {
        overlay.width = width;
        overlay.height = height;
      }

      drawGuide(overlay, message);
    },
    []
  );

  const setGuideStatus = useCallback(
    (message: string) => {
      guideMessageRef.current = message;
      setGuideMessage((previous) => (previous === message ? previous : message));
      renderGuide(message);
    },
    [renderGuide]
  );

  const stopCamera = useCallback(() => {
    clearAutoCaptureTimeout();
    stopDetectionLoop();

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    }

    setCameraActive(false);
    setCaptureState("idle");
    setGuideStatus(getIdleGuideMessage());
  }, [clearAutoCaptureTimeout, setGuideStatus, stopDetectionLoop]);

  useEffect(() => {
    return () => {
      if (capturedPreviewUrl) {
        URL.revokeObjectURL(capturedPreviewUrl);
      }
      stopCamera();
    };
  }, [capturedPreviewUrl, stopCamera]);

  const loadRegisteredCards = useCallback(async () => {
    setBusy("loading");
    setError(null);

    try {
      const response = await client.listCardReferences();
      setReferences(response.references);
      setReferenceDir(response.referenceDir);
    } catch (loadError) {
      setError(formatSecureKitError(loadError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client]);

  useEffect(() => {
    void loadRegisteredCards();
  }, [loadRegisteredCards]);

  const captureGuideBlob = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !video.videoWidth || video.readyState < 2) {
      throw new Error("Camera frame is not ready yet.");
    }

    const guide = getGuideSourceRect(video, getOverlaySize(overlay));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(guide.w);
    canvas.height = Math.round(guide.h);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Card capture canvas is not available.");
    }

    context.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error("Failed to capture the card image."));
        },
        "image/jpeg",
        0.95
      );
    });
  }, []);

  const captureAndVerify = useCallback(async () => {
    const currentReference = selectedReferenceRef.current;
    const currentCardLabel = selectedCardLabelRef.current;

    if (!currentReference) {
      setError("No registered card reference is available.");
      setGuideStatus("Selected card is missing on the backend. Refresh the references.");
      setCaptureState("idle");
      renderGuide("Selected card is missing on the backend.");
      return;
    }

    clearAutoCaptureTimeout();
    stopDetectionLoop();
    setBusy("verifying");
    setCaptureState("capturing");
    setError(null);
    setVerifyResult(null);
    setGuideStatus(`Captured ${currentCardLabel}. Comparing now...`);

    try {
      const blob = await captureGuideBlob();
      setCapturedCard(blob);

      const result = await client.verifyCard({
        probeImage: blob,
        probeFileName: "card-capture.jpg",
        referenceId: currentReference.id,
      });
      setVerifyResult(result);

      if (result.matched) {
        setGuideStatus(`${currentCardLabel} matched successfully.`);
      } else {
        setGuideStatus(`${currentCardLabel} did not pass the threshold.`);
      }
    } catch (verifyError) {
      setError(formatSecureKitError(verifyError, baseUrl));
      setGuideStatus("Verification failed. Adjust the card and retry.");
    } finally {
      setBusy("idle");
      setCaptureState("idle");
    }
  }, [
    baseUrl,
    captureGuideBlob,
    client,
    clearAutoCaptureTimeout,
    renderGuide,
    setGuideStatus,
    stopDetectionLoop,
  ]);

  const runDetectionLoop = useCallback(() => {
    detectionFrameRef.current = null;

    if (!streamRef.current || !videoRef.current?.srcObject) {
      return;
    }

    const video = videoRef.current;
    if (!video || !video.videoWidth || video.readyState < 2) {
      detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
      return;
    }

    const now = performance.now();
    if (now - lastAnalysisAtRef.current < CARD_ANALYSIS_INTERVAL_MS) {
      detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
      return;
    }

    lastAnalysisAtRef.current = now;

    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement("canvas");
    }

    const metrics = analyzeGuideForCard(video, analysisCanvasRef.current, getOverlaySize(overlayRef.current));

    if (!metrics?.detected) {
      const hadStableFrames = detectionHoldFramesRef.current > 0;
      detectionHoldFramesRef.current = 0;
      clearAutoCaptureTimeout();
      setCaptureState("watching");

      if (hadStableFrames || guideMessageRef.current !== getWaitingGuideMessage(selectedCardLabelRef.current)) {
        setGuideStatus(getWaitingGuideMessage(selectedCardLabelRef.current));
      }

      detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
      return;
    }

    detectionHoldFramesRef.current += 1;
    setCaptureState("watching");

    if (detectionHoldFramesRef.current < CARD_DETECTION_HOLD_FRAMES) {
      clearAutoCaptureTimeout();
      setGuideStatus(
        `${selectedCardLabelRef.current} detected. Hold steady (${detectionHoldFramesRef.current}/${CARD_DETECTION_HOLD_FRAMES}).`
      );
      detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
      return;
    }

    if (autoCaptureTimeoutRef.current === null) {
      setGuideStatus(
        `${selectedCardLabelRef.current} detected. Capturing in ${(
          AUTO_CAPTURE_DELAY_MS / 1000
        ).toFixed(1)} seconds.`
      );
      autoCaptureTimeoutRef.current = window.setTimeout(() => {
        autoCaptureTimeoutRef.current = null;
        void captureAndVerify();
      }, AUTO_CAPTURE_DELAY_MS);
    }

    detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
  }, [captureAndVerify, clearAutoCaptureTimeout, setGuideStatus]);

  const startDetectionLoop = useCallback(() => {
    if (detectionFrameRef.current !== null) {
      return;
    }

    detectionFrameRef.current = window.requestAnimationFrame(runDetectionLoop);
  }, [runDetectionLoop]);

  const armAutoCapture = useCallback(() => {
    const currentReference = selectedReferenceRef.current;
    const currentCardLabel = selectedCardLabelRef.current;

    if (!streamRef.current || !videoRef.current?.srcObject) return;
    if (!currentReference) {
      setError("No registered card reference is available.");
      setGuideStatus("Selected card is missing on the backend. Refresh the references.");
      renderGuide("Selected card is missing on the backend.");
      return;
    }

    clearAutoCaptureTimeout();
    stopDetectionLoop();
    setError(null);
    setVerifyResult(null);
    setCaptureState("watching");
    detectionHoldFramesRef.current = 0;
    setGuideStatus(getWaitingGuideMessage(currentCardLabel));
    startDetectionLoop();
  }, [clearAutoCaptureTimeout, renderGuide, setGuideStatus, startDetectionLoop, stopDetectionLoop]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API is not available in this browser.");
      return;
    }

    if (!selectedReference) {
      setError("No registered card reference is available.");
      return;
    }

    stopCamera();
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("Camera preview is not ready.");
      }

      video.srcObject = stream;
      await video.play();

      setCameraActive(true);
      setCaptureState("idle");
      setGuideStatus(getReadyGuideMessage(selectedCardLabel));
    } catch (cameraError) {
      stopCamera();
      setError(cameraError instanceof Error ? cameraError.message : "Failed to start camera.");
    }
  }, [selectedCardLabel, selectedReference, setGuideStatus, stopCamera]);

  const restartAutoCapture = useCallback(() => {
    if (!cameraActive) {
      setError("Start the camera before scanning a card.");
      return;
    }

    armAutoCapture();
  }, [armAutoCapture, cameraActive]);

  const captureNow = useCallback(() => {
    if (!cameraActive) {
      setError("Start the camera before capturing a card.");
      return;
    }

    void captureAndVerify();
  }, [cameraActive, captureAndVerify]);

  const handleCardChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextReferenceId = event.target.value;
      const nextReference =
        references.find((reference) => reference.id === nextReferenceId) ?? null;
      const nextCardLabel = getCardLabel(nextReference);
      selectedReferenceIdRef.current = nextReferenceId;
      selectedReferenceRef.current = nextReference;
      selectedCardLabelRef.current = nextCardLabel;
      setSelectedReferenceId(nextReferenceId);
      setError(null);
      setVerifyResult(null);

      if (cameraActive && busy === "idle") {
        if (!nextReference) {
          clearAutoCaptureTimeout();
          stopDetectionLoop();
          setCaptureState("idle");
          setError("Selected card was not found in backend references.");
          setGuideStatus("Selected card is missing on the backend. Refresh the references.");
          renderGuide("Selected card is missing on the backend.");
          return;
        }

        clearAutoCaptureTimeout();
        stopDetectionLoop();
        setCaptureState("idle");
        setGuideStatus(getReadyGuideMessage(nextCardLabel));
      }
    },
    [
      busy,
      cameraActive,
      clearAutoCaptureTimeout,
      renderGuide,
      references,
      setGuideStatus,
      stopDetectionLoop,
    ]
  );

  const busyText =
    busy === "loading"
      ? "Refreshing registered cards..."
      : busy === "verifying"
        ? `Comparing captured image with ${selectedCardLabel}...`
        : captureState === "watching"
          ? `Auto capture is watching for ${selectedCardLabel}...`
          : captureState === "capturing"
            ? "Capturing card image..."
            : null;

  return (
    <section
      style={{
        padding: 16,
        border: "1px solid #d0d5dd",
        borderRadius: 10,
        marginBottom: 16,
        background: "#fff",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Card Verification</h2>
      <p>
        API Base: <code>{baseUrl}</code>
      </p>
      <p>This screen compares the capture with the selected registered card reference.</p>
      <p>Manual capture is available as soon as the camera starts. Auto capture is optional.</p>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Registered card</span>
          <select
            value={selectedReference?.id ?? ""}
            onChange={handleCardChange}
            disabled={references.length === 0}
          >
            {references.length === 0 ? (
              <option value="">No references found</option>
            ) : (
              references.map((reference) => (
                <option key={reference.id} value={reference.id}>
                  {getCardLabel(reference)}
                </option>
              ))
            )}
          </select>
        </label>

        <div>
          <h4 style={{ margin: "0 0 8px" }}>Registered References</h4>
          <p style={{ margin: "0 0 8px", color: "#475467", fontSize: 14 }}>
            Reference dir: <code>{referenceDir ?? "-"}</code>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {references.length === 0 ? (
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px dashed #d0d5dd",
                  background: "#f8fafc",
                  color: "#667085",
                  fontSize: 13,
                }}
              >
                none
              </span>
            ) : (
              references.map((reference) => {
                const selected = reference.id === selectedReference?.id;
                return (
                  <span
                    key={reference.id}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: selected ? "1px solid #2563eb" : "1px solid #16a34a",
                      background: selected ? "#eff6ff" : "#f0fdf4",
                      color: "#101828",
                      fontSize: 13,
                    }}
                  >
                    {getCardLabel(reference)}
                  </span>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px" }}>Guide Status</h4>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid #d0d5dd",
              background: captureState === "capturing" ? "#fff7ed" : "#f8fafc",
            }}
          >
            <p style={{ margin: 0 }}>
              <b>Selected card:</b> {selectedCardLabel}
            </p>
            <p style={{ margin: "6px 0 0" }}>
              <b>Instruction:</b> {guideMessage}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={() => void loadRegisteredCards()} disabled={busy !== "idle"}>
          Refresh Cards
        </button>
        {!cameraActive ? (
          <button
            onClick={() => void startCamera()}
            disabled={busy !== "idle" || selectedReference == null}
          >
            Start Camera
          </button>
        ) : (
          <>
            <button
              onClick={captureNow}
              disabled={busy !== "idle" || selectedReference == null}
            >
              Capture Photo
            </button>
            <button
              onClick={restartAutoCapture}
              disabled={busy !== "idle" || selectedReference == null}
            >
              {captureState === "watching" ? "Restart Auto Capture" : "Start Auto Capture"}
            </button>
            <button onClick={stopCamera} disabled={busy === "verifying"}>
              Stop Camera
            </button>
          </>
        )}
      </div>

      <div style={MEDIA_GRID_STYLE}>
        <div style={MEDIA_PANEL_STYLE}>
          <h4 style={{ margin: "0 0 8px" }}>Live Camera</h4>
          <div style={CAMERA_STAGE_STYLE}>
            <video
              ref={videoRef}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
              muted
              playsInline
            />
            <canvas
              ref={overlayRef}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        <div style={MEDIA_PANEL_STYLE}>
          <h4 style={{ margin: "0 0 8px" }}>Captured Card</h4>
          <div style={CAPTURE_STAGE_STYLE}>
            {capturedPreviewUrl ? (
              <div style={CAPTURE_CARD_WINDOW_STYLE}>
                <img
                  src={capturedPreviewUrl}
                  alt="Captured card preview"
                  style={PREVIEW_IMAGE_STYLE}
                />
              </div>
            ) : (
              <div style={PREVIEW_EMPTY_STYLE}>No card captured yet.</div>
            )}
          </div>
        </div>
      </div>

      {busyText && <p style={{ marginTop: 12 }}>{busyText}</p>}
      {error && <p style={{ color: "#b42318" }}>Error: {error}</p>}

      {verifyResult && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border: verifyResult.matched ? "1px solid #86efac" : "1px solid #fdba74",
            background: verifyResult.matched ? "#f0fdf4" : "#fff7ed",
          }}
        >
          <p style={{ margin: 0 }}>
            <b>Selected card:</b> {selectedCardLabel}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Match result:</b>{" "}
            {verifyResult.matched ? "Selected card matched" : "Selected card did not match"}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Checked references:</b> {verifyResult.checkedCount} | <b>Threshold:</b>{" "}
            {verifyResult.threshold.toFixed(2)}
          </p>
          {verifyResult.bestMatch && (
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: 0 }}>
                <b>Best match:</b> {verifyResult.bestMatch.referenceFileName}
              </p>
              <p style={{ margin: "6px 0 0" }}>
                <b>Overall:</b> {toPercent(verifyResult.bestMatch.overallScore)} |{" "}
                <b>Content:</b> {toPercent(verifyResult.bestMatch.contentScore)} |{" "}
                <b>CLIP:</b> {toPercent(verifyResult.bestMatch.visualScore)}
                {verifyResult.bestMatch.visualDetails ? (
                  <>
                    {" "}
                    | <b>CLIP detail:</b>{" "}
                    {toOptionalPercent(verifyResult.bestMatch.visualDetails.clipScore)}
                  </>
                ) : null}
              </p>
              <p style={{ margin: "6px 0 0" }}>
                <b>Decision:</b> {verifyResult.bestMatch.decision}
                {verifyResult.bestMatch.reasons.length > 0
                  ? ` | Reasons: ${verifyResult.bestMatch.reasons.join(", ")}`
                  : ""}
              </p>
              <p style={{ margin: "6px 0 0" }}>
                <b>Probe fields:</b>{" "}
                {verifyResult.bestMatch.fields.probe.name || "-"} /{" "}
                {verifyResult.bestMatch.fields.probe.studentNo || "-"} /{" "}
                {verifyResult.bestMatch.fields.probe.documentNo || "-"} /{" "}
                {verifyResult.bestMatch.fields.probe.cardNo || "-"}
              </p>
              <p style={{ margin: "6px 0 0" }}>
                <b>Reference fields:</b>{" "}
                {verifyResult.bestMatch.fields.reference.name || "-"} /{" "}
                {verifyResult.bestMatch.fields.reference.studentNo || "-"} /{" "}
                {verifyResult.bestMatch.fields.reference.documentNo || "-"} /{" "}
                {verifyResult.bestMatch.fields.reference.cardNo || "-"}
              </p>
              <p style={{ margin: "6px 0 0" }}>
                <b>Quality:</b>{" "}
                probe card {verifyResult.bestMatch.quality.cardDetectedProbe ? "detected" : "not detected"}
                , reference card{" "}
                {verifyResult.bestMatch.quality.cardDetectedReference ? "detected" : "not detected"}
                , OCR {verifyResult.bestMatch.quality.ocrAvailable ? "available" : "unavailable"}
                {verifyResult.bestMatch.quality.ocrWeak ? " (weak)" : ""}
              </p>
            </div>
          )}

          <details style={{ marginTop: 12 }}>
            <summary>Verification response</summary>
            <pre>{pretty(verifyResult)}</pre>
          </details>
        </div>
      )}
    </section>
  );
};
