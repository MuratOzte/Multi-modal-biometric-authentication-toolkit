export type KeystrokeEvent = {
  key?: string;
  code?: string;
  type: "down" | "up";
  t: number;
  isRepeat?: boolean;
  location?: number;
  expectedIndex?: number;
};

export type KeystrokeSample = {
  events: KeystrokeEvent[];
  expectedText?: string;
  challengeId?: string;
  typedLength?: number;
  errorCount?: number;
  backspaceCount?: number;
  ignoredEventCount?: number;
  imeCompositionUsed?: boolean;
  source?: "legacy" | "collector_v1";
};

export type KeystrokeSampleMetrics = {
  holdMeanMs: number;
  holdStdMs: number;
  holdMedianMs: number;
  flightMeanMs: number;
  flightStdMs: number;
  flightMedianMs: number;
  ddMeanMs: number;
  ddStdMs: number;
  ddMedianMs: number;
  udMeanMs: number;
  udStdMs: number;
  udMedianMs: number;
  uuMeanMs: number;
  uuStdMs: number;
  uuMedianMs: number;
  typingSpeedCharsPerSec: number;
  errorRate: number;
  backspaceRate: number;
  digraphCount: number;
  keystrokeCount: number;
  eventCount: number;
  durationMs: number;
  startDelayMs: number;
  interWordPauseMeanMs: number;
  interWordPauseStdMs: number;
  interWordPauseMedianMs: number;
  interWordPauseCount: number;
  longPauseRate: number;
  correctionBurstRate: number;
};

export type KeystrokeProfile = {
  userId: string;
  createdAt: string;
  updatedAt: string;
  sampleCount: number;
  sampleRoundCount?: number;
  holdMeanMs: number;
  holdStdMs: number;
  holdMedianMs?: number;
  flightMeanMs: number;
  flightStdMs: number;
  flightMedianMs?: number;
  digraphCount?: number;
  ddMeanMs?: number;
  ddStdMs?: number;
  ddMedianMs?: number;
  udMeanMs?: number;
  udStdMs?: number;
  udMedianMs?: number;
  uuMeanMs?: number;
  uuStdMs?: number;
  uuMedianMs?: number;
  typingSpeedMean?: number;
  typingSpeedStd?: number;
  errorRateMean?: number;
  backspaceRateMean?: number;
  startDelayMean?: number;
  startDelayStd?: number;
  interWordPauseMean?: number;
  interWordPauseStd?: number;
  longPauseRateMean?: number;
  correctionBurstRateMean?: number;
};

export type EnrollKeystrokeRequest = {
  userId: string;
  challengeId?: string;
  events?: KeystrokeEvent[];
  sample?: KeystrokeSample;
  expectedText?: string;
  typedLength?: number;
  errorCount?: number;
  backspaceCount?: number;
  imeCompositionUsed?: boolean;
};

export type EnrollmentProgress = {
  roundsCompleted: number;
  roundsTarget: number;
  roundsRemaining: number;
  keystrokesCollected: number;
  keystrokesTarget: number;
  keystrokesRemaining: number;
  ready: boolean;
};

export type EnrollKeystrokeResponse = {
  ok: true;
  profile: KeystrokeProfile;
  sampleMetrics?: KeystrokeSampleMetrics;
  enrollmentProgress?: EnrollmentProgress;
  reasons?: string[];
};
