export type CardGuideRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CardPresenceMetrics = {
  detected: boolean;
  cardScore: number;
  detailScore: number;
  contrastScore: number;
  borderScore: number;
  fillScore: number;
  aspectScore: number;
};

export const CARD_AUTO_CAPTURE_DELAY_MS = 500;
export const CARD_ANALYSIS_INTERVAL_MS = 140;
export const CARD_DETECTION_HOLD_FRAMES = 4;

const GUIDE_ASPECT_RATIO = 1.58;
const CAPTURE_OVERSCAN_RATIO = 0.08;
const CARD_ANALYSIS_WIDTH = 160;
const CARD_ANALYSIS_HEIGHT = Math.round(CARD_ANALYSIS_WIDTH / GUIDE_ASPECT_RATIO);
const CARD_DETECTION_THRESHOLD = 0.62;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getCardGuideRect(width: number, height: number): CardGuideRect {
  const maxWidth = width * 0.78;
  const maxHeight = height * 0.54;
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

function addGuideOverscan(
  rect: CardGuideRect,
  boundsWidth: number,
  boundsHeight: number
): CardGuideRect {
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

export function analyzeCardGuide(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
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

  const guide = getCardGuideRect(video.videoWidth, video.videoHeight);
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

export function drawCardGuide(
  canvas: HTMLCanvasElement,
  message: string,
  title = "Card capture"
): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width || 640;
  const height = canvas.height || 480;
  const guide = getCardGuideRect(width, height);

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
  context.fillText(title, badgeX + 14, badgeY + 20);
  context.font = "400 13px Sora, sans-serif";
  context.fillText(message, badgeX + 14, badgeY + 40, badgeWidth - 28);
  context.restore();
}

export async function captureCardGuideBlob(video: HTMLVideoElement | null): Promise<Blob> {
  if (!video || !video.videoWidth || video.readyState < 2) {
    throw new Error("Camera frame is not ready yet.");
  }

  const guide = addGuideOverscan(
    getCardGuideRect(video.videoWidth, video.videoHeight),
    video.videoWidth,
    video.videoHeight
  );
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
}
