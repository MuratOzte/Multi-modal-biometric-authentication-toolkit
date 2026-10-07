import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeTextResponse,
  ConsentResponse,
  GetProfilesResponse,
  VoiceEnrollmentResponse,
  VoiceVerificationResult,
} from "@securekit/core";
import {
  createSecureKitClient,
  formatSecureKitError,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";

type BusyState = "idle" | "challenge" | "recording" | "enroll" | "verify";

type VoiceUserId = string;

type VoiceUserOption = {
  value: string;
  label: string;
};

type VoiceProfileStatus = {
  state: "loading" | "registered" | "unregistered" | "unknown";
  sampleCount: number | null;
  requiredSamples: number;
  updatedAt: string | null;
  legacy: boolean;
  error: string | null;
};

const REQUIRED_VOICE_SAMPLES = 3;
const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const DEFAULT_VOICE_USERS: VoiceUserOption[] = [
  { value: "mert", label: "Mert" },
  { value: "murat", label: "Murat" },
  { value: "emre", label: "Emre" },
];

const PREVIEW_FRAME_STYLE: React.CSSProperties = {
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

const EMPTY_PROFILE_STATUS: VoiceProfileStatus = {
  state: "loading",
  sampleCount: null,
  requiredSamples: REQUIRED_VOICE_SAMPLES,
  updatedAt: null,
  legacy: false,
  error: null,
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function toAudioUrl(file: Blob | null): string | null {
  if (!file) return null;
  return URL.createObjectURL(file);
}

function runtimeLabel(result: VoiceEnrollmentResponse | VoiceVerificationResult | null): string {
  if (!result) return "-";
  const runtime = result.runtime;
  const device = runtime.device === "cuda" ? "CUDA GPU" : "CPU";
  const gpu = runtime.cudaDeviceName ? ` (${runtime.cudaDeviceName})` : "";
  const fallback = runtime.fallbackReason ? `, fallback: ${runtime.fallbackReason}` : "";
  return `${device}${gpu}${fallback}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const body = error.body;
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

function isConsentRequiredError(error: unknown): boolean {
  return errorCode(error) === "CONSENT_REQUIRED";
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

function mergeVoiceUsers(...groups: VoiceUserOption[][]): VoiceUserOption[] {
  const merged = new Map<string, VoiceUserOption>();

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

function resolveVoiceProfileStatus(
  response: GetProfilesResponse,
  requiredSamples = REQUIRED_VOICE_SAMPLES
): VoiceProfileStatus {
  const { profiles } = response;
  const voice = profiles.voice ?? null;
  const hasLegacyVoiceEmbedding =
    Array.isArray(profiles.voiceEmbedding) && profiles.voiceEmbedding.length > 0;
  const sampleCount = voice?.sampleCount ?? (hasLegacyVoiceEmbedding ? requiredSamples : 0);
  const registered = hasLegacyVoiceEmbedding || sampleCount >= requiredSamples;

  return {
    state: registered ? "registered" : "unregistered",
    sampleCount,
    requiredSamples,
    updatedAt: voice?.updatedAt ?? profiles.updatedAt ?? null,
    legacy: !voice && hasLegacyVoiceEmbedding,
    error: null,
  };
}

function statusLabel(status: VoiceProfileStatus): string {
  if (status.state === "loading") return "Kontrol ediliyor...";
  if (status.state === "registered") return "Kayıtlı";
  if (status.state === "unregistered") return "Kayıtlı değil";
  return "Durum okunamadı";
}

function statusDetail(status: VoiceProfileStatus): string {
  if (status.state === "loading") return "Durum güncelleniyor.";
  if (status.state === "unknown") return status.error ?? "Profil durumu okunamadı.";
  if (status.legacy) return "Mevcut ses profili bulundu.";
  if (status.sampleCount !== null) {
    return `${Math.min(status.sampleCount, status.requiredSamples)} / ${status.requiredSamples} örnek`;
  }
  return "-";
}

function statusStyle(status: VoiceProfileStatus): React.CSSProperties {
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

export const VoiceVerificationTester: React.FC = () => {
  const baseUrl = useMemo(() => resolveSecureKitBaseUrl(), []);
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [userId, setUserId] = useState<VoiceUserId>("mert");
  const [voiceUsers, setVoiceUsers] = useState<VoiceUserOption[]>(DEFAULT_VOICE_USERS);
  const [newUserId, setNewUserId] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [userListError, setUserListError] = useState<string | null>(null);
  const [addUserMessage, setAddUserMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeTextResponse | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [consentResult, setConsentResult] = useState<ConsentResponse | null>(null);
  const [enrollResult, setEnrollResult] = useState<VoiceEnrollmentResponse | null>(null);
  const [verifyResult, setVerifyResult] = useState<VoiceVerificationResult | null>(null);
  const [profileStatus, setProfileStatus] =
    useState<VoiceProfileStatus>(EMPTY_PROFILE_STATUS);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const profileRequestIdRef = useRef(0);

  const refreshVoiceUsers = useCallback(async () => {
    try {
      const response = await client.listUsers();
      const backendUsers = response.users.map((user) => ({
        value: user.userId,
        label: formatUserLabel(user.userId),
      }));
      const nextUsers = mergeVoiceUsers(DEFAULT_VOICE_USERS, backendUsers);

      setVoiceUsers(nextUsers);
      setUserListError(null);
      setUserId((current) => {
        const normalized = normalizeUserIdInput(current);
        return nextUsers.some((user) => user.value === normalized)
          ? normalized
          : nextUsers[0]?.value ?? normalized;
      });
    } catch (usersError) {
      setVoiceUsers((current) => mergeVoiceUsers(DEFAULT_VOICE_USERS, current));
      setUserListError(formatSecureKitError(usersError, baseUrl));
    }
  }, [baseUrl, client]);

  useEffect(() => {
    void refreshVoiceUsers();
  }, [refreshVoiceUsers]);

  const refreshProfileStatus = useCallback(async () => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    setProfileStatus(EMPTY_PROFILE_STATUS);

    try {
      const response = await client.getProfiles(userId);
      if (profileRequestIdRef.current !== requestId) return;
      setProfileStatus(resolveVoiceProfileStatus(response));
    } catch (profileError) {
      if (profileRequestIdRef.current !== requestId) return;
      setProfileStatus({
        ...EMPTY_PROFILE_STATUS,
        state: "unknown",
        error: formatSecureKitError(profileError, baseUrl),
      });
    }
  }, [baseUrl, client, userId]);

  const handleAddVoiceUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedUserId = normalizeUserIdInput(newUserId);

      setAddUserMessage(null);
      if (!isValidUserId(normalizedUserId)) {
        setError(
          "Kullanıcı ID 2-32 karakter olmalı; küçük harf, rakam, nokta, tire veya alt çizgi kullanın."
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

        setVoiceUsers((current) => mergeVoiceUsers(DEFAULT_VOICE_USERS, current, [nextUser]));
        setUserId(response.userId);
        setNewUserId("");
        setAddUserMessage(response.created ? "Kişi eklendi ve seçildi." : "Kişi seçildi.");
        void refreshVoiceUsers();
      } catch (addError) {
        setError(formatSecureKitError(addError, baseUrl));
      } finally {
        setAddingUser(false);
      }
    },
    [baseUrl, client, newUserId, refreshVoiceUsers]
  );

  useEffect(() => {
    setError(null);
    setChallenge(null);
    setRecordedAudio(null);
    setConsentResult(null);
    setEnrollResult(null);
    setVerifyResult(null);
    void refreshProfileStatus();
  }, [refreshProfileStatus]);

  useEffect(() => {
    const nextUrl = toAudioUrl(recordedAudio);
    setAudioUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
  }, [recordedAudio]);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      stopStream();
    };
  }, [audioUrl, stopStream]);

  const requestChallenge = useCallback(async () => {
    setBusy("challenge");
    setError(null);
    setRecordedAudio(null);
    setVerifyResult(null);

    try {
      const response = await client.getTextChallenge({
        lang: "tr",
        length: "short",
        ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
      });
      setChallenge(response);
    } catch (challengeError) {
      setError(formatSecureKitError(challengeError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, client, sessionId]);

  const startRecording = useCallback(async () => {
    if (!challenge) {
      setError("Kayıttan önce yeni bir ses cümlesi oluşturun.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("MediaRecorder or microphone access is not available in this browser.");
      return;
    }

    setError(null);
    setRecordedAudio(null);
    setVerifyResult(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;

      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        setRecordedAudio(new Blob(chunksRef.current, { type }));
        setBusy("idle");
        stopStream();
      };
      recorder.start();
      setBusy("recording");
    } catch (recordError) {
      stopStream();
      setBusy("idle");
      setError(recordError instanceof Error ? recordError.message : "Could not start recording.");
    }
  }, [challenge, stopStream]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopStream();
      setBusy("idle");
      return;
    }

    recorder.stop();
  }, [stopStream]);

  const runEnrollment = useCallback(async () => {
    if (!challenge || !recordedAudio) {
      setError("Kayıt ettirmeden önce mevcut ses cümlesini kaydedin.");
      return;
    }

    setBusy("enroll");
    setError(null);

    const enrollmentArgs = {
      userId,
      challengeId: challenge.challengeId,
      audioSample: recordedAudio,
      audioFileName: "voice-enroll.webm",
      minEnrollmentSamples: REQUIRED_VOICE_SAMPLES,
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    };

    try {
      let response: VoiceEnrollmentResponse;
      try {
        response = await client.enrollVoice(enrollmentArgs);
      } catch (enrollError) {
        if (!isConsentRequiredError(enrollError)) {
          throw enrollError;
        }

        const consent = await client.grantConsent({
          userId,
          consentVersion: "voice-v1",
        });
        setConsentResult(consent);
        response = await client.enrollVoice(enrollmentArgs);
      }

      setEnrollResult(response);
      setProfileStatus({
        state: response.enrollmentProgress.complete ? "registered" : "unregistered",
        sampleCount: response.enrollmentProgress.sampleCount,
        requiredSamples: response.enrollmentProgress.requiredSamples,
        updatedAt: response.profile.updatedAt,
        legacy: false,
        error: null,
      });
      setChallenge(null);
      setRecordedAudio(null);
    } catch (enrollError) {
      setError(formatSecureKitError(enrollError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, challenge, client, recordedAudio, sessionId, userId]);

  const runVerification = useCallback(async () => {
    if (profileStatus.state !== "registered") {
      setError("Bu kişi ses için kayıtlı değil. Önce kayıt olması gerekiyor.");
      return;
    }

    if (!challenge || !recordedAudio) {
      setError("Doğrulamadan önce mevcut ses cümlesini kaydedin.");
      return;
    }

    setBusy("verify");
    setError(null);

    try {
      const response = await client.verifyVoice({
        userId,
        challengeId: challenge.challengeId,
        audioSample: recordedAudio,
        audioFileName: "voice-verify.webm",
        matchThreshold: 0.85,
        stepUpThreshold: 0.5,
        denyThreshold: 0.35,
        transcriptThreshold: 0.78,
        ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
      });
      setVerifyResult(response);
      if (response.profile) {
        setProfileStatus({
          state: "registered",
          sampleCount: response.profile.sampleCount,
          requiredSamples: REQUIRED_VOICE_SAMPLES,
          updatedAt: response.profile.updatedAt,
          legacy: false,
          error: null,
        });
      }
      setChallenge(null);
      setRecordedAudio(null);
    } catch (verifyError) {
      setError(formatSecureKitError(verifyError, baseUrl));
    } finally {
      setBusy("idle");
    }
  }, [baseUrl, challenge, client, profileStatus.state, recordedAudio, sessionId, userId]);

  const activeResult = verifyResult ?? enrollResult;
  const enrollmentProgress = enrollResult?.enrollmentProgress;
  const recording = busy === "recording";
  const userControlsDisabled = busy !== "idle" || addingUser;
  const controlsDisabled = userControlsDisabled || profileStatus.state === "loading";
  const canVerifyVoice = profileStatus.state === "registered";
  const addUserDisabled = userControlsDisabled || !newUserId.trim();
  const busyText =
    busy === "challenge"
      ? "Ses cümlesi oluşturuluyor..."
      : busy === "recording"
        ? "Kayıt alınıyor..."
        : busy === "enroll"
          ? "Ses kaydı işleniyor..."
          : busy === "verify"
            ? "Ses doğrulanıyor..."
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
      <h2 style={{ marginTop: 0 }}>Ses Doğrulama</h2>
      <p>
        API Base: <code>{baseUrl}</code>
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Kişi</span>
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={userControlsDisabled}
          >
            {voiceUsers.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>sessionId (optional)</span>
          <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
        </label>
        <div style={PREVIEW_FRAME_STYLE}>
          <div>
            <b>Ses kaydı</b>
          </div>
          <div style={statusStyle(profileStatus)}>{statusLabel(profileStatus)}</div>
          <div>{statusDetail(profileStatus)}</div>
        </div>
        <div style={PREVIEW_FRAME_STYLE}>
          <div>
            <b>Runtime</b>
          </div>
          <div>{runtimeLabel(activeResult)}</div>
        </div>
      </div>

      <form
        onSubmit={(event) => void handleAddVoiceUser(event)}
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
          <b>Yeni kişi</b>
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Kullanıcı ID</span>
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
              {addingUser ? "Ekleniyor..." : "Seçime ekle"}
            </button>
          </div>
        </div>
        {addUserMessage && <div style={{ color: "#166534", fontWeight: 600 }}>{addUserMessage}</div>}
        {userListError && <div style={{ color: "#92400e" }}>Kişi listesi okunamadı.</div>}
      </form>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={() => void requestChallenge()} disabled={controlsDisabled}>
          Yeni ses cümlesi
        </button>
        {!recording ? (
          <button onClick={() => void startRecording()} disabled={controlsDisabled || !challenge}>
            Kaydı başlat
          </button>
        ) : (
          <button onClick={stopRecording}>Kaydı durdur</button>
        )}
        <button onClick={() => void runEnrollment()} disabled={controlsDisabled || !recordedAudio || !challenge}>
          Kayıt ettir
        </button>
        <button
          onClick={() => void runVerification()}
          disabled={controlsDisabled || !recordedAudio || !challenge || !canVerifyVoice}
        >
          Sesi doğrula
        </button>
      </div>

      {!canVerifyVoice && profileStatus.state !== "loading" && (
        <p style={{ color: "#b42318", fontWeight: 600 }}>
          Bu kişi ses için kayıtlı değil. Önce kayıt olması gerekiyor.
        </p>
      )}

      <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <div style={PREVIEW_FRAME_STYLE}>
          <div>
            <b>Ses cümlesi</b>
          </div>
          <div style={{ fontSize: 20, lineHeight: 1.4 }}>{challenge?.text ?? "Aktif cümle yok."}</div>
        </div>
        <div style={PREVIEW_FRAME_STYLE}>
          <div>
            <b>Alınan kayıt</b>
          </div>
          {audioUrl ? <audio controls src={audioUrl} /> : <div>Henüz ses kaydı yok.</div>}
        </div>
        <div style={PREVIEW_FRAME_STYLE}>
          <div>
            <b>Kayıt ilerlemesi</b>
          </div>
          <div>
            {enrollmentProgress
              ? `${enrollmentProgress.sampleCount} / ${enrollmentProgress.requiredSamples} örnek`
              : statusDetail(profileStatus)}
          </div>
        </div>
      </div>

      {busyText && <p style={{ marginTop: 12 }}>{busyText}</p>}
      {error && <p style={{ color: "#b42318" }}>Error: {error}</p>}
      {consentResult && (
        <p style={{ color: "#166534" }}>
          Consent otomatik kaydedildi: <code>{consentResult.grantedAt}</code>
        </p>
      )}

      {activeResult && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            border:
              "decision" in activeResult && activeResult.decision === "deny"
                ? "1px solid #fdba74"
                : "1px solid #86efac",
            background:
              "decision" in activeResult && activeResult.decision === "deny"
                ? "#fff7ed"
                : "#f0fdf4",
          }}
        >
          {"decision" in activeResult && (
            <p style={{ margin: 0 }}>
              <b>Decision:</b> {activeResult.decision} | <b>Score:</b>{" "}
              {activeResult.similarityScore.toFixed(3)}
            </p>
          )}
          <p style={{ margin: "6px 0 0" }}>
            <b>Transcript:</b> {activeResult.transcript.transcript ?? "-"}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <b>Text match:</b> {activeResult.transcript.similarityScore.toFixed(3)} /{" "}
            {activeResult.transcript.threshold.toFixed(2)}
          </p>

          <details style={{ marginTop: 12 }}>
            <summary>Voice response</summary>
            <pre>{pretty(activeResult)}</pre>
          </details>
        </div>
      )}
    </section>
  );
};
