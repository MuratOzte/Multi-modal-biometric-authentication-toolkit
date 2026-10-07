import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeTextResponse,
  LocationResult,
  NetworkResult,
  VoiceSignal,
} from "@securekit/core";
import {
  createFixedTextKeystrokeRecorder,
  type FixedTextInvalidReason,
  type FixedTextKeystrokeSample,
} from "@securekit/web-sdk";
import {
  createSecureKitClient,
  formatSecureKitError,
  postSecureKitJson,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";
import {
  captureVideoFrame,
  runFaceCaptureSeries,
  type FaceSeriesProgress,
} from "../lib/faceCaptureSeries.js";

type AuthMode = "login" | "register";
type Flow = "login" | "register" | null;
type StepId = "face" | "card" | "voice" | "keystroke";
type BusyState =
  | "idle"
  | "account"
  | "camera"
  | "face"
  | "card"
  | "challenge"
  | "recording"
  | "voice"
  | "keystroke"
  | "session";

type SessionState = {
  sessionId: string;
  expiresAt: string;
};

type FixedTextEnrollResponse = {
  ok: true;
  enrolled: true;
  template: {
    count: number;
    dim: number;
  };
};

type FixedTextVerifyResponse = {
  ok: true;
  decision: "accept" | "reject";
  score: number;
  dist: number;
  autoEnrolled: boolean;
  reason?: string;
};

type KeystrokeCaptureStatus = {
  complete: boolean;
  invalidReason: FixedTextInvalidReason | null;
};

type TypingPreviewTokenState = "typed" | "active" | "pending" | "mismatch" | "extra";

type TypingPreviewToken = {
  key: string;
  char: string;
  state: TypingPreviewTokenState;
};

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "face", label: "Yüz" },
  { id: "card", label: "Kart" },
  { id: "voice", label: "Ses" },
  { id: "keystroke", label: "Klavye" },
];

const FIXED_TEXT = "guvenli giris kontrolu";
const FIXED_TEXT_ID = "main-flow-tr-v1";
const KEYSTROKE_TARGET = 5;
const VOICE_TARGET = 3;

function toBlobUrl(file: Blob | null): string | null {
  if (!file) return null;
  return URL.createObjectURL(file);
}

function invalidReasonMessage(reason: FixedTextInvalidReason | null): string {
  if (!reason) return "";

  switch (reason) {
    case "invalid_expected_text":
      return "Klavye metni gecersiz. Yeniden dene.";
    case "modifier_or_control_key":
    case "non_character_key":
      return "Sadece metindeki karakterleri ve Backspace tusunu kullan.";
    case "key_repeat":
      return "Tekrarli tus algilandi. Daha dogal sekilde tekrar dene.";
    case "text_mismatch":
      return "Yanlis harfi Backspace ile silip devam et.";
    case "extra_input":
      return "Metin bitti. Fazla karakteri Backspace ile sil.";
    case "keyup_without_keydown":
    case "duplicate_keyup":
      return "Tus sirasi gecersiz algilandi. Metni yeniden yaz.";
    default:
      return "Bu tur gecersiz oldu. Metni yeniden yaz.";
  }
}

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function buildStatusLabel(args: {
  flow: Flow;
  activeStep: StepId;
  completed: StepId[];
  stepId: StepId;
}): string {
  if (args.completed.includes(args.stepId)) return "Tamam";
  if (args.flow && args.activeStep === args.stepId) return "Aktif";
  return "Bekliyor";
}

function faceSeriesMessage(progress: FaceSeriesProgress): string {
  if (progress.phase === "capture") {
    return `Yuz analizi icin fotograf cekiliyor (${progress.index}/${progress.total}).`;
  }
  if (progress.phase === "verify") {
    return `Fotograf analiz ediliyor (${progress.index}/${progress.total}).`;
  }
  return `Sonraki fotograf icin bekleniyor (${progress.index}/${progress.total}).`;
}

function faceScoreText(score: number | null | undefined): string {
  return typeof score === "number" ? score.toFixed(3) : "yok";
}

function buildTypingPreviewTokens(
  expectedText: string,
  typedText: string
): TypingPreviewToken[] {
  const expectedChars = Array.from(expectedText);
  const typedChars = Array.from(typedText);
  const tokenCount = Math.max(expectedChars.length, typedChars.length);
  const tokens: TypingPreviewToken[] = [];

  for (let index = 0; index < tokenCount; index += 1) {
    const expectedChar = expectedChars[index];
    const typedChar = typedChars[index];
    let state: TypingPreviewTokenState = "pending";

    if (typedChar !== undefined && expectedChar === undefined) {
      state = "extra";
    } else if (typedChar !== undefined && typedChar !== expectedChar) {
      state = "mismatch";
    } else if (typedChar !== undefined) {
      state = "typed";
    } else if (index === typedChars.length) {
      state = "active";
    }

    tokens.push({
      key: `${index}:${typedChar ?? expectedChar ?? ""}`,
      char: typedChar ?? expectedChar ?? "",
      state,
    });
  }

  return tokens;
}

function typingPreviewHasError(tokens: TypingPreviewToken[]): boolean {
  return tokens.some((token) => token.state === "mismatch" || token.state === "extra");
}

function typingPreviewClass(state: TypingPreviewTokenState): string {
  if (state === "typed") return "auth-typing-char-ok";
  if (state === "mismatch") return "auth-typing-char-bad";
  if (state === "extra") return "auth-typing-char-extra";
  if (state === "active") return "auth-typing-char-active";
  return "auth-typing-char-pending";
}

function isSubmitSpaceKeydown(event: React.KeyboardEvent<HTMLInputElement>): boolean {
  return event.key === " " && event.currentTarget.value === FIXED_TEXT;
}

function preventNonAppendEdit(
  event: React.KeyboardEvent<HTMLInputElement>,
  setNotice: React.Dispatch<React.SetStateAction<string>>
): boolean {
  if (event.key === "Delete") {
    event.preventDefault();
    setNotice("Sadece sondan Backspace ile duzeltme yapabilirsin.");
    return true;
  }

  if (event.key !== "Backspace" && event.key.length !== 1) return false;

  const input = event.currentTarget;
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? input.value.length;
  const atAppendPoint =
    selectionStart === input.value.length && selectionEnd === input.value.length;

  if (atAppendPoint) return false;

  event.preventDefault();
  setNotice("Sadece sondan yazip sondan Backspace ile duzeltme yapabilirsin.");
  return true;
}

export function AuthApp() {
  const baseUrl = useMemo(() => resolveSecureKitBaseUrl(), []);
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [mode, setMode] = useState<AuthMode>("login");
  const [flow, setFlow] = useState<Flow>(null);
  const [activeStep, setActiveStep] = useState<StepId>("face");
  const [completedSteps, setCompletedSteps] = useState<StepId[]>([]);
  const [userId, setUserId] = useState("emre");
  const [password, setPassword] = useState("emre");
  const [session, setSession] = useState<SessionState | null>(null);
  const [networkSignal, setNetworkSignal] = useState<NetworkResult | null>(null);
  const [locationSignal, setLocationSignal] = useState<LocationResult | null>(null);
  const [voiceSignal, setVoiceSignal] = useState<VoiceSignal | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [message, setMessage] = useState("Giriş yapmak veya yeni kayıt oluşturmak için hazır.");
  const [error, setError] = useState<string | null>(null);
  const [doneTitle, setDoneTitle] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<Blob | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [cardUpload, setCardUpload] = useState<File | null>(null);

  const [voiceChallenge, setVoiceChallenge] = useState<ChallengeTextResponse | null>(null);
  const [voiceAudio, setVoiceAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [voiceEnrollCount, setVoiceEnrollCount] = useState(0);

  const [typedText, setTypedText] = useState("");
  const [keystrokeCapture, setKeystrokeCapture] = useState<KeystrokeCaptureStatus>({
    complete: false,
    invalidReason: null,
  });
  const [keystrokeSamples, setKeystrokeSamples] = useState<FixedTextKeystrokeSample[]>([]);
  const [keystrokeNotice, setKeystrokeNotice] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keystrokeInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef(createFixedTextKeystrokeRecorder(FIXED_TEXT));
  const skipSubmitSpaceKeyupRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const keystrokePreviewTokens = useMemo(
    () => buildTypingPreviewTokens(FIXED_TEXT, typedText),
    [typedText]
  );
  const keystrokeDraftHasError = useMemo(
    () => typingPreviewHasError(keystrokePreviewTokens),
    [keystrokePreviewTokens]
  );

  useEffect(() => {
    const nextUrl = toBlobUrl(capturedImage);
    setCapturedPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
  }, [capturedImage]);

  useEffect(() => {
    const nextUrl = toBlobUrl(voiceAudio);
    setAudioUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
  }, [voiceAudio]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, [audioUrl, capturedPreviewUrl, stopCamera]);

  const refreshKeystrokeCapture = useCallback(() => {
    const recorder = recorderRef.current;
    setKeystrokeCapture({
      complete: recorder.isComplete(),
      invalidReason: recorder.getInvalidReason(),
    });
  }, []);

  const resetStepState = useCallback(() => {
    setCapturedImage(null);
    setCardUpload(null);
    setVoiceChallenge(null);
    setVoiceAudio(null);
    setTypedText("");
    setKeystrokeCapture({ complete: false, invalidReason: null });
    setKeystrokeSamples([]);
    setKeystrokeNotice("");
    recorderRef.current = createFixedTextKeystrokeRecorder(FIXED_TEXT);
    skipSubmitSpaceKeyupRef.current = false;
  }, []);

  const moveToStep = useCallback(
    (step: StepId) => {
      stopCamera();
      resetStepState();
      setActiveStep(step);
    },
    [resetStepState, stopCamera]
  );

  const finishLogin = useCallback(async () => {
    try {
      if (!session) {
        throw new Error("Oturum bulunamadı.");
      }

      await client.verifySession({
        sessionId: session.sessionId,
        userId,
        policy: {
          voice: { enabled: true },
          stepUpSteps: ["voice", "keystroke"],
        },
        signals: {
          ...(networkSignal ? { network: networkSignal } : {}),
          ...(locationSignal ? { location: locationSignal } : {}),
          ...(voiceSignal ? { voice: voiceSignal } : {}),
        },
      });

      setDoneTitle("Giriş tamamlandı");
      setMessage("Tüm doğrulamalar geçti. Oturum güvenli şekilde açıldı.");
      setFlow(null);
    } catch (sessionError) {
      setError(formatSecureKitError(sessionError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client, locationSignal, networkSignal, session, userId, voiceSignal]);

  const completeStep = useCallback(
    (step: StepId) => {
      setCompletedSteps((current) => (current.includes(step) ? current : [...current, step]));
      const currentIndex = STEPS.findIndex((entry) => entry.id === step);
      const next = STEPS[currentIndex + 1]?.id;

      if (next) {
        moveToStep(next);
        setMessage(`${STEPS[currentIndex]?.label ?? "Adım"} tamamlandı. Sıradaki adım hazır.`);
        return;
      }

      stopCamera();
      resetStepState();
      if (flow === "register") {
        setDoneTitle("Kayıt tamamlandı");
        setMessage("Biyometrik kayıtlar hazır. Artık giriş ekranından oturum açabilirsin.");
        setFlow(null);
        setMode("login");
        setPassword(userId);
        return;
      }

      setBusy("session");
      setMessage("Son oturum kararı hazırlanıyor.");
      void finishLogin();
    },
    [flow, moveToStep, resetStepState, stopCamera, userId]
  );

  const runPassiveSignals = useCallback(
    async (sessionId: string) => {
      const [network, location] = await Promise.allSettled([
        client.verifyNetwork(),
        client.verifyLocation(),
      ]);

      if (network.status === "fulfilled") setNetworkSignal(network.value);
      if (location.status === "fulfilled") setLocationSignal(location.value);

      if (network.status === "fulfilled" || location.status === "fulfilled") {
        setMessage("Ağ ve konum sinyalleri arka planda eklendi.");
      } else {
        setMessage("Ağ sinyalleri alınamadı; doğrulama adımlarıyla devam edebilirsin.");
      }

      return sessionId;
    },
    [client]
  );

  const handleAccountSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const normalizedUserId = userId.trim().toLowerCase();
      if (!normalizedUserId || !password) {
        setError("Kullanıcı adı ve şifre gerekli.");
        return;
      }

      setBusy("account");
      setError(null);
      setDoneTitle(null);
      setCompletedSteps([]);
      setVoiceSignal(null);
      setNetworkSignal(null);
      setLocationSignal(null);
      resetStepState();
      stopCamera();

      try {
        if (mode === "register") {
          await client.register({ userId: normalizedUserId, password });
          await client.grantConsent({
            userId: normalizedUserId,
            consentVersion: "main-flow-v1",
          });
          setUserId(normalizedUserId);
          setFlow("register");
          setActiveStep("face");
          setMessage("Hesap hazır. Önce yüz kaydını alalım.");
          return;
        }

        await client.login({ userId: normalizedUserId, password });
        const started = await client.startSession();
        setUserId(normalizedUserId);
        setSession(started);
        setFlow("login");
        setActiveStep("face");
        setMessage("Şifre doğru. Yüz doğrulama ile devam et.");
        void runPassiveSignals(started.sessionId);
      } catch (accountError) {
        setError(formatSecureKitError(accountError, baseUrl));
      } finally {
        setBusy("idle");
      }
    },
    [
      baseUrl,
      client,
      mode,
      password,
      resetStepState,
      runPassiveSignals,
      stopCamera,
      userId,
    ]
  );

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Bu tarayıcı kamera erişimini desteklemiyor.");
      return;
    }

    setBusy("camera");
    setError(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setMessage("Kamera hazır. Görüntü netleşince yakala.");
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "Kamera başlatılamadı.");
    } finally {
      setBusy("idle");
    }
  }, [stopCamera]);

  const captureCurrentFrame = useCallback(async (): Promise<Blob> => {
    return captureVideoFrame(videoRef.current);
  }, []);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("Kamera görüntüsü hazır değil.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Görüntü yakalanamadı.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setError("Görüntü dosyası oluşturulamadı.");
      return;
    }

    setCapturedImage(blob);
    setError(null);
    setMessage("Görüntü alındı. Adımı tamamlayabilirsin.");
  }, []);

  const submitFace = useCallback(async () => {
    if (!flow) {
      return;
    }
    if (!cameraActive && !capturedImage) {
      setError("Önce yüz görüntüsü yakala.");
      return;
    }

    setBusy("face");
    setError(null);
    try {
      if (cameraActive) {
        const outcome = await runFaceCaptureSeries({
          capture: async () => {
            const blob = await captureCurrentFrame();
            setCapturedImage(blob);
            return blob;
          },
          verify: async (image, index) =>
            client.verifyFaceSlidingWindow({
              userId,
              probeImage: image,
              probeFileName: `face-${flow}-${index}.jpg`,
              maxWindow: 3,
              updateOnSuccess: flow === "register",
            }),
          isSuccess: (result) =>
            flow === "register"
              ? result.ok && (result.matched || result.windowSizeAfter > 0)
              : result.ok && result.matched,
          onProgress: (progress) => setMessage(faceSeriesMessage(progress)),
        });

        const selected = outcome.bestSuccess ?? outcome.bestAttempt;
        if (selected?.image) {
          setCapturedImage(selected.image);
        }

        if (!outcome.bestSuccess?.result || !outcome.bestSuccess.image) {
          const bestScore = faceScoreText(outcome.bestAttempt?.result?.score);
          if (outcome.lastError) {
            throw new Error(`${formatSecureKitError(outcome.lastError, baseUrl)} En iyi skor: ${bestScore}.`);
          }
          throw new Error(`Yuz dogrulanamadi. En iyi skor: ${bestScore}.`);
        }

        if (flow === "register") {
          await client.enrollFaceReference({
            userId,
            referenceImage: outcome.bestSuccess.image,
            referenceFileName: "face-reference.jpg",
          });
        }

        if (flow === "login") {
          void client
            .verifyFaceSlidingWindow({
              userId,
              probeImage: outcome.bestSuccess.image,
              probeFileName: "face-login-update.jpg",
              maxWindow: 3,
              updateOnSuccess: true,
            })
            .catch(() => undefined);
        }

        setMessage(
          `Yuz adimi tamamlandi. En iyi skor: ${faceScoreText(outcome.bestSuccess.result.score)}.`
        );
        completeStep("face");
        return;
      }

      const faceImage = capturedImage;
      if (!faceImage) {
        setError("Once yuz goruntusu yakala.");
        return;
      }

      if (flow === "register") {
        const result = await client.verifyFaceSlidingWindow({
          userId,
          probeImage: faceImage,
          probeFileName: "face-register.jpg",
          maxWindow: 3,
          updateOnSuccess: true,
        });

        if (!result.ok || (!result.matched && result.windowSizeAfter === 0)) {
          throw new Error("Yüz kaydı alınamadı. Işığı artırıp tekrar dene.");
        }

        await client.enrollFaceReference({
          userId,
          referenceImage: faceImage,
          referenceFileName: "face-reference.jpg",
        });

        completeStep("face");
        return;
      }

      const result = await client.verifyFaceSlidingWindow({
        userId,
        probeImage: faceImage,
        probeFileName: "face-login.jpg",
        maxWindow: 3,
        updateOnSuccess: false,
      });

      if (!result.ok || !result.matched) {
        throw new Error("Yüz doğrulanamadı. Lütfen tekrar dene.");
      }

      void client
        .verifyFaceSlidingWindow({
          userId,
          probeImage: faceImage,
          probeFileName: "face-login-update.jpg",
          maxWindow: 3,
          updateOnSuccess: true,
        })
        .catch(() => undefined);

      completeStep("face");
    } catch (faceError) {
      setError(formatSecureKitError(faceError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, cameraActive, capturedImage, captureCurrentFrame, client, completeStep, flow, userId]);

  const submitCard = useCallback(async () => {
    if (!flow) return;
    const cardImage = cardUpload ?? capturedImage;
    if (!cardImage) {
      setError("Kart görseli yükle veya kameradan yakala.");
      return;
    }

    setBusy("card");
    setError(null);
    try {
      if (flow === "register") {
        await client.enrollCardReference({
          userId,
          referenceImage: cardImage,
          referenceFileName: "card-reference.jpg",
        });
        completeStep("card");
        return;
      }

      const result = await client.verifyCard({
        userId,
        probeImage: cardImage,
        probeFileName: "card-login.jpg",
      });

      if (!result.ok || !result.matched) {
        throw new Error("Kart doğrulanamadı. Kartı düz ve net göstererek tekrar dene.");
      }

      completeStep("card");
    } catch (cardError) {
      setError(formatSecureKitError(cardError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, capturedImage, cardUpload, client, completeStep, flow, userId]);

  const requestVoiceChallenge = useCallback(async () => {
    setBusy("challenge");
    setError(null);
    try {
      const challenge = await client.getTextChallenge({
        lang: "tr",
        length: "short",
        ...(session?.sessionId ? { sessionId: session.sessionId } : {}),
      });
      setVoiceChallenge(challenge);
      setVoiceAudio(null);
      setMessage("Metni yüksek sesle oku ve kaydı durdur.");
    } catch (challengeError) {
      setError(formatSecureKitError(challengeError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client, session]);

  const stopAudioStream = useCallback(() => {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const startRecording = useCallback(async () => {
    if (!voiceChallenge) {
      setError("Önce ses metni oluştur.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Bu tarayıcı mikrofon kaydını desteklemiyor.");
      return;
    }

    setError(null);
    setVoiceAudio(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        setVoiceAudio(new Blob(audioChunksRef.current, { type }));
        setBusy("idle");
        stopAudioStream();
      };
      recorder.start();
      setBusy("recording");
      setMessage("Kayıt alınıyor.");
    } catch (recordError) {
      stopAudioStream();
      setBusy("idle");
      setError(recordError instanceof Error ? recordError.message : "Mikrofon başlatılamadı.");
    }
  }, [stopAudioStream, voiceChallenge]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setBusy("idle");
      stopAudioStream();
      return;
    }
    recorder.stop();
  }, [stopAudioStream]);

  const submitVoice = useCallback(async () => {
    if (!flow || !voiceChallenge || !voiceAudio) {
      setError("Ses metnini kaydetmen gerekiyor.");
      return;
    }

    setBusy("voice");
    setError(null);
    try {
      if (flow === "register") {
        const result = await client.enrollVoice({
          userId,
          challengeId: voiceChallenge.challengeId,
          audioSample: voiceAudio,
          audioFileName: "voice-register.webm",
          minEnrollmentSamples: VOICE_TARGET,
          ...(session?.sessionId ? { sessionId: session.sessionId } : {}),
        });

        setVoiceEnrollCount(result.enrollmentProgress.sampleCount);
        setVoiceChallenge(null);
        setVoiceAudio(null);

        if (result.enrollmentProgress.complete) {
          completeStep("voice");
        } else {
          setMessage(
            `Ses örneği alındı (${result.enrollmentProgress.sampleCount}/${VOICE_TARGET}). Yeni metin oluştur.`
          );
        }
        return;
      }

      const result = await client.verifyVoice({
        userId,
        challengeId: voiceChallenge.challengeId,
        audioSample: voiceAudio,
        audioFileName: "voice-login.webm",
        matchThreshold: 0.85,
        stepUpThreshold: 0.5,
        denyThreshold: 0.35,
        transcriptThreshold: 0.78,
        ...(session?.sessionId ? { sessionId: session.sessionId } : {}),
      });

      if (!result.matched || result.decision !== "allow") {
        throw new Error("Ses doğrulanamadı. Metni net okuyup tekrar dene.");
      }

      setVoiceSignal(result.signalsUsed.voice);
      completeStep("voice");
    } catch (voiceError) {
      setError(formatSecureKitError(voiceError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client, completeStep, flow, session, userId, voiceAudio, voiceChallenge]);

  const resetKeystrokeRound = useCallback((notice = "") => {
    recorderRef.current = createFixedTextKeystrokeRecorder(FIXED_TEXT);
    skipSubmitSpaceKeyupRef.current = false;
    setTypedText("");
    setKeystrokeCapture({ complete: false, invalidReason: null });
    setKeystrokeNotice(notice);
  }, []);

  const addKeystrokeSample = useCallback(() => {
    const sample = recorderRef.current.getSample(FIXED_TEXT_ID);
    if (!sample) {
      setKeystrokeNotice("Metni eksiksiz yazinca ornek eklenir.");
      return;
    }
    setKeystrokeSamples((current) => [...current, sample]);
    resetKeystrokeRound("Ornek alindi.");
  }, [resetKeystrokeRound]);

  const submitKeystroke = useCallback(async () => {
    if (!flow) return;

    setBusy("keystroke");
    setError(null);
    try {
      if (flow === "register") {
        if (keystrokeSamples.length < KEYSTROKE_TARGET) {
          setKeystrokeNotice(`${KEYSTROKE_TARGET} örnek gerekiyor.`);
          return;
        }

        await postSecureKitJson<FixedTextEnrollResponse>(
          "/keystroke/enroll",
          {
            userId,
            textId: FIXED_TEXT_ID,
            expectedText: FIXED_TEXT,
            samples: keystrokeSamples,
          },
          baseUrl
        );
        completeStep("keystroke");
        return;
      }

      const sample = recorderRef.current.getSample(FIXED_TEXT_ID);
      if (!sample) {
        setKeystrokeNotice("Metni eksiksiz yazinca dogrulama yapilir.");
        return;
      }

      const result = await postSecureKitJson<FixedTextVerifyResponse>(
        "/keystroke/verify",
        {
          userId,
          textId: FIXED_TEXT_ID,
          expectedText: FIXED_TEXT,
          sample,
          opts: { autoEnroll: true },
        },
        baseUrl
      );

      if (result.decision !== "accept") {
        throw new Error("Klavye davranışı eşleşmedi. Metni doğal hızınla tekrar yaz.");
      }

      completeStep("keystroke");
    } catch (keystrokeError) {
      setError(formatSecureKitError(keystrokeError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, completeStep, flow, keystrokeSamples, userId]);

  const completeKeystrokeFromSpace = useCallback(() => {
    if (busy !== "idle") return;

    if (!recorderRef.current.isComplete()) {
      refreshKeystrokeCapture();
      setKeystrokeNotice("Metin tamamlaninca Space tusu bitirir.");
      return;
    }

    if (flow === "register") {
      addKeystrokeSample();
      return;
    }

    void submitKeystroke();
  }, [addKeystrokeSample, busy, flow, refreshKeystrokeCapture, submitKeystroke]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault();
        setKeystrokeNotice("Kopyalama ve kisayollar kapali.");
        return;
      }

      if (preventNonAppendEdit(event, setKeystrokeNotice)) return;

      if (isSubmitSpaceKeydown(event)) {
        event.preventDefault();
        skipSubmitSpaceKeyupRef.current = true;
        completeKeystrokeFromSpace();
        return;
      }

      if (event.key !== "Backspace" && event.key.length !== 1) return;

      recorderRef.current.keydown({ key: event.key, repeat: event.repeat });
      const invalidReason = recorderRef.current.getInvalidReason();
      if (invalidReason) {
        event.preventDefault();
        resetKeystrokeRound(invalidReasonMessage(invalidReason));
        return;
      }

      refreshKeystrokeCapture();
    },
    [completeKeystrokeFromSpace, refreshKeystrokeCapture, resetKeystrokeRound]
  );

  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") return;
      if (event.key === " " && skipSubmitSpaceKeyupRef.current) {
        skipSubmitSpaceKeyupRef.current = false;
        return;
      }
      if (event.key !== "Backspace" && event.key.length !== 1) return;

      recorderRef.current.keyup({ key: event.key });
      const invalidReason = recorderRef.current.getInvalidReason();
      if (invalidReason) {
        resetKeystrokeRound(invalidReasonMessage(invalidReason));
        return;
      }

      refreshKeystrokeCapture();
    },
    [refreshKeystrokeCapture, resetKeystrokeRound]
  );

  const accountDisabled = busy !== "idle" || flow !== null;
  const canUseCamera = activeStep === "face" || activeStep === "card";
  const currentStepLabel = STEPS.find((step) => step.id === activeStep)?.label ?? "";

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <aside className="auth-rail">
          <div>
            <p className="auth-kicker">SecureKit</p>
            <h1>Güvenli giriş</h1>
            <p className="auth-copy">
              Şifreyi doğrula, ardından kimlik adımlarını sakin bir sırayla tamamla.
            </p>
          </div>

          <div className="auth-progress" aria-label="Doğrulama adımları">
            {STEPS.map((step, index) => (
              <div
                className={`auth-progress-row ${
                  activeStep === step.id && flow ? "auth-progress-row-active" : ""
                } ${completedSteps.includes(step.id) ? "auth-progress-row-done" : ""}`}
                key={step.id}
              >
                <span>{index + 1}</span>
                <strong>{step.label}</strong>
                <em>
                  {buildStatusLabel({
                    flow,
                    activeStep,
                    completed: completedSteps,
                    stepId: step.id,
                  })}
                </em>
              </div>
            ))}
          </div>
        </aside>

        <section className="auth-workspace">
          <div className="auth-mode-switch">
            <button
              className={mode === "login" ? "is-active" : ""}
              disabled={flow !== null}
              onClick={() => {
                setMode("login");
                setDoneTitle(null);
                setMessage("Giriş yapmak için hazır.");
              }}
              type="button"
            >
              Giriş
            </button>
            <button
              className={mode === "register" ? "is-active" : ""}
              disabled={flow !== null}
              onClick={() => {
                setMode("register");
                setDoneTitle(null);
                setMessage("Yeni kayıt oluşturmak için hazır.");
              }}
              type="button"
            >
              Kayıt
            </button>
          </div>

          <form className="auth-account" onSubmit={handleAccountSubmit}>
            <label>
              Kullanıcı
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                disabled={accountDisabled}
                autoCapitalize="off"
                autoComplete="username"
              />
            </label>
            <label>
              Şifre
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={accountDisabled}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>
            <button disabled={accountDisabled} type="submit">
              {busy === "account"
                ? "Kontrol ediliyor"
                : mode === "login"
                  ? "Girişe başla"
                  : "Kaydı başlat"}
            </button>
          </form>

          <div className="auth-status" role="status">
            {doneTitle ? <strong>{doneTitle}</strong> : <strong>{currentStepLabel || "Hazır"}</strong>}
            <span>{message}</span>
            {session && flow === "login" && <small>Oturum: {session.sessionId.slice(0, 8)}</small>}
          </div>

          {error && <div className="auth-error">{error}</div>}

          {flow && (
            <div className="auth-stage">
              {canUseCamera && (
                <div className="auth-camera">
                  <video ref={videoRef} muted playsInline />
                  {!cameraActive && <div className="auth-camera-empty">Kamera kapalı</div>}
                </div>
              )}

              {activeStep === "face" && (
                <section className="auth-step-panel">
                  <h2>{flow === "register" ? "Yüz kaydı" : "Yüz doğrulama"}</h2>
                  <p>Yüzünü kadraja al, net bir görüntü yakala ve devam et.</p>
                  <div className="auth-actions">
                    <button disabled={busy !== "idle"} onClick={() => void startCamera()} type="button">
                      Kamerayı aç
                    </button>
                    <button disabled={!cameraActive || busy !== "idle"} onClick={() => void captureFrame()} type="button">
                      Görüntü yakala
                    </button>
                    <button disabled={!(cameraActive || capturedImage) || busy !== "idle"} onClick={() => void submitFace()} type="button">
                      {busy === "face" ? "İşleniyor" : "Yüz adımını tamamla"}
                    </button>
                  </div>
                  {capturedPreviewUrl && (
                    <img className="auth-preview" src={capturedPreviewUrl} alt="Yakalanan yüz" />
                  )}
                </section>
              )}

              {activeStep === "card" && (
                <section className="auth-step-panel">
                  <h2>{flow === "register" ? "Kart kaydı" : "Kart doğrulama"}</h2>
                  <p>Kartı yükle veya kamera ile yakala. Görüntü düz ve okunabilir olmalı.</p>
                  <label className="auth-file">
                    Kart görseli
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => setCardUpload(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="auth-actions">
                    <button disabled={busy !== "idle"} onClick={() => void startCamera()} type="button">
                      Kamerayı aç
                    </button>
                    <button disabled={!cameraActive || busy !== "idle"} onClick={() => void captureFrame()} type="button">
                      Kartı yakala
                    </button>
                    <button
                      disabled={!(cardUpload || capturedImage) || busy !== "idle"}
                      onClick={() => void submitCard()}
                      type="button"
                    >
                      {busy === "card" ? "Kontrol ediliyor" : "Kart adımını tamamla"}
                    </button>
                  </div>
                  {cardUpload && <span className="auth-chip">{cardUpload.name}</span>}
                  {!cardUpload && capturedPreviewUrl && (
                    <img className="auth-preview" src={capturedPreviewUrl} alt="Yakalanan kart" />
                  )}
                </section>
              )}

              {activeStep === "voice" && (
                <section className="auth-step-panel">
                  <h2>{flow === "register" ? "Ses kaydı" : "Ses doğrulama"}</h2>
                  <p>
                    {flow === "register"
                      ? `${VOICE_TARGET} kısa ses örneği alınacak.`
                      : "Tek kullanımlık metni sesli oku."}
                  </p>
                  <div className="auth-phrase">{voiceChallenge?.text ?? "Ses metni bekliyor."}</div>
                  <div className="auth-actions">
                    <button disabled={busy !== "idle"} onClick={() => void requestVoiceChallenge()} type="button">
                      Yeni metin
                    </button>
                    {busy === "recording" ? (
                      <button onClick={stopRecording} type="button">
                        Kaydı durdur
                      </button>
                    ) : (
                      <button
                        disabled={!voiceChallenge || busy !== "idle"}
                        onClick={() => void startRecording()}
                        type="button"
                      >
                        Kaydı başlat
                      </button>
                    )}
                    <button
                      disabled={!voiceAudio || !voiceChallenge || busy !== "idle"}
                      onClick={() => void submitVoice()}
                      type="button"
                    >
                      {busy === "voice" ? "İşleniyor" : "Ses adımını tamamla"}
                    </button>
                  </div>
                  {audioUrl && <audio controls src={audioUrl} />}
                  {flow === "register" && (
                    <span className="auth-chip">
                      Ses örneği: {voiceEnrollCount}/{VOICE_TARGET}
                    </span>
                  )}
                </section>
              )}

              {activeStep === "keystroke" && (
                <section className="auth-step-panel">
                  <h2>{flow === "register" ? "Klavye kaydı" : "Klavye doğrulama"}</h2>
                  <p>Metni doğal hızınla yaz. Kopyalama kapalıdır.</p>
                  <div className="auth-phrase auth-typing-preview" aria-live="polite">
                    {keystrokePreviewTokens.map((token) => (
                      <span
                        className={`auth-typing-char ${typingPreviewClass(token.state)}`}
                        key={token.key}
                      >
                        {token.char === " " ? "\u00A0" : token.char}
                      </span>
                    ))}
                  </div>
                  <input
                    ref={keystrokeInputRef}
                    className={`auth-typing ${
                      keystrokeDraftHasError || keystrokeCapture.invalidReason
                        ? "auth-typing-bad"
                        : keystrokeCapture.complete
                          ? "auth-typing-ok"
                          : ""
                    }`}
                    value={typedText}
                    onChange={(event) => {
                      setTypedText(event.target.value);
                      if (keystrokeNotice) setKeystrokeNotice("");
                    }}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                    onPaste={(event) => event.preventDefault()}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="auth-actions">
                    {flow === "register" && (
                      <button
                        disabled={!keystrokeCapture.complete || busy !== "idle"}
                        onClick={addKeystrokeSample}
                        type="button"
                      >
                        Örnek ekle
                      </button>
                    )}
                    <button
                      disabled={
                        busy !== "idle" ||
                        (flow === "register"
                          ? keystrokeSamples.length < KEYSTROKE_TARGET
                          : !keystrokeCapture.complete)
                      }
                      onClick={() => void submitKeystroke()}
                      type="button"
                    >
                      {busy === "keystroke" ? "İşleniyor" : "Klavye adımını tamamla"}
                    </button>
                  </div>
                  <span className="auth-chip">
                    {flow === "register"
                      ? `Örnek: ${keystrokeSamples.length}/${KEYSTROKE_TARGET}`
                      : keystrokeCapture.complete
                        ? "Metin tamam"
                        : "Metin bekleniyor"}
                  </span>
                  {keystrokeNotice && <small className="auth-note">{keystrokeNotice}</small>}
                </section>
              )}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
