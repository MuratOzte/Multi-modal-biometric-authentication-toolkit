import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFixedTextKeystrokeRecorder,
  type FixedTextInvalidReason,
  type FixedTextKeystrokeSample,
} from "@securekit/web-sdk";
import {
  createSecureKitClient,
  formatSecureKitError,
  getSecureKitJson,
  postSecureKitJson,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";
import {
  type AddEnrollmentSampleOptions,
  type CaptureStatus,
  type FixedTextEnrollResponse,
  type FixedTextVerifyResponse,
  type ResetCaptureOptions,
  DEFAULT_EXPECTED_TEXT,
  buildTypingPreviewTokens,
  countWords,
  focusTypingInputSoon,
  formatFixedTextError,
  getExpectedTextValidationMessage,
  hasTypingPreviewError,
  invalidAutoRestartMessage,
  invalidReasonMessage,
  parseIntInRange,
} from "./FixedTextKeystrokePlayground.utils.js";

type ActiveFixedTextTemplate = {
  userId: string;
  textId: string;
  expectedText: string;
  sampleCount?: number;
  updatedAt?: number;
};

type FixedTextUserOption = {
  value: string;
  label: string;
};

type FixedTextTemplateStatus = {
  state: "loading" | "registered" | "unregistered" | "unknown";
  sampleCount: number | null;
  updatedAt: number | null;
  error: string | null;
};

type FixedTextStatusResponse = {
  ok: true;
  userId: string;
  textId: string;
  registered: boolean;
  template: null | {
    expectedText: string;
    sampleCount: number;
    updatedAt: number;
  };
};

const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const DEFAULT_FIXED_TEXT_USERS: FixedTextUserOption[] = [
  { value: "mert", label: "Mert" },
  { value: "murat", label: "Murat" },
  { value: "emre", label: "Emre" },
];

const EMPTY_TEMPLATE_STATUS: FixedTextTemplateStatus = {
  state: "loading",
  sampleCount: null,
  updatedAt: null,
  error: null,
};

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

function mergeFixedTextUsers(...groups: FixedTextUserOption[][]): FixedTextUserOption[] {
  const merged = new Map<string, FixedTextUserOption>();

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

function templateStatusLabel(status: FixedTextTemplateStatus, enrollmentMode: boolean): string {
  if (enrollmentMode) return "Yeni kayıt";
  if (status.state === "loading") return "Kontrol ediliyor...";
  if (status.state === "registered") return "Kayıtlı";
  if (status.state === "unregistered") return "Kayıtlı değil";
  return "Durum okunamadı";
}

function templateStatusDetail(status: FixedTextTemplateStatus, enrollmentMode: boolean): string {
  if (enrollmentMode) return "Bu kişi için yeni klavye kaydı alınacak.";
  if (status.state === "loading") return "Klavye kaydı aranıyor.";
  if (status.state === "unknown") return status.error ?? "Klavye kaydı okunamadı.";
  if (status.state === "registered") {
    const sampleText = status.sampleCount !== null ? `${status.sampleCount} örnek` : "profil var";
    return `Doğrulama aktif: ${sampleText}.`;
  }
  return "Bu kişi klavye için kayıtlı değil. Önce kayıt olması gerekiyor.";
}

function preventNonAppendEdit(
  event: React.KeyboardEvent<HTMLInputElement>,
  setError: React.Dispatch<React.SetStateAction<string | null>>
): boolean {
  if (event.key !== "Backspace" && event.key.length !== 1) return false;

  const input = event.currentTarget;
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? input.value.length;
  const atAppendPoint = selectionStart === input.value.length && selectionEnd === input.value.length;

  if (atAppendPoint) return false;

  event.preventDefault();
  setError("Sadece sondan yazip sondan Backspace ile duzeltme yapabilirsin.");
  return true;
}

function isSubmitSpaceKeydown(
  event: React.KeyboardEvent<HTMLInputElement>,
  expectedText: string
): boolean {
  return event.key === " " && event.currentTarget.value === expectedText;
}

export function useFixedTextKeystrokePlaygroundController() {
  const baseUrl = useMemo(() => resolveSecureKitBaseUrl(), []);
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [userId, setUserId] = useState("mert");
  const [fixedTextUsers, setFixedTextUsers] =
    useState<FixedTextUserOption[]>(DEFAULT_FIXED_TEXT_USERS);
  const [newUserId, setNewUserId] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [userListError, setUserListError] = useState<string | null>(null);
  const [addUserMessage, setAddUserMessage] = useState<string | null>(null);
  const [textId, setTextId] = useState("tr-medium-fixed-v1");
  const [expectedText, setExpectedText] = useState(DEFAULT_EXPECTED_TEXT);
  const [targetSamplesInput, setTargetSamplesInput] = useState("10");
  const [autoEnroll, setAutoEnroll] = useState(true);
  const [enrollmentMode, setEnrollmentMode] = useState(false);
  const [templateStatus, setTemplateStatus] =
    useState<FixedTextTemplateStatus>(EMPTY_TEMPLATE_STATUS);

  const [enrollTyped, setEnrollTyped] = useState("");
  const [verifyTyped, setVerifyTyped] = useState("");

  const [enrollCapture, setEnrollCapture] = useState<CaptureStatus>({
    complete: false,
    invalidReason: null,
  });
  const [verifyCapture, setVerifyCapture] = useState<CaptureStatus>({
    complete: false,
    invalidReason: null,
  });

  const [enrollSamples, setEnrollSamples] = useState<FixedTextKeystrokeSample[]>([]);
  const [lastSample, setLastSample] = useState<FixedTextKeystrokeSample | null>(null);

  const [enrollBusy, setEnrollBusy] = useState<"idle" | "loading">("idle");
  const [verifyBusy, setVerifyBusy] = useState<"idle" | "loading">("idle");

  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [enrollResult, setEnrollResult] = useState<FixedTextEnrollResponse | null>(null);
  const [verifyResult, setVerifyResult] = useState<FixedTextVerifyResponse | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<ActiveFixedTextTemplate | null>(null);

  const enrollInputRef = useRef<HTMLInputElement | null>(null);
  const verifyInputRef = useRef<HTMLInputElement | null>(null);
  const enrollRecorderRef = useRef(createFixedTextKeystrokeRecorder(DEFAULT_EXPECTED_TEXT));
  const verifyRecorderRef = useRef(createFixedTextKeystrokeRecorder(DEFAULT_EXPECTED_TEXT));
  const skipEnrollSpaceKeyupRef = useRef(false);
  const skipVerifySpaceKeyupRef = useRef(false);
  const pendingEnrollSpaceSubmitRef = useRef(false);
  const pendingVerifySpaceSubmitRef = useRef(false);
  const statusRequestIdRef = useRef(0);

  const normalizedExpectedText = expectedText.trim();
  const setupLocked = activeTemplate !== null && !enrollmentMode;
  const verificationAvailable = activeTemplate !== null && !enrollmentMode;
  const verifyExpectedText = activeTemplate?.expectedText ?? normalizedExpectedText;
  const expectedTextWasTrimmed = normalizedExpectedText !== expectedText;
  const expectedLength = Array.from(normalizedExpectedText).length;
  const expectedWordCount = countWords(normalizedExpectedText);
  const targetSamples = parseIntInRange(targetSamplesInput, 10, 1, 50);
  const expectedTextValidationMessage = getExpectedTextValidationMessage(
    expectedWordCount,
    expectedLength
  );
  const expectedTextValid = expectedTextValidationMessage === null;
  const enrollPreviewTokens = useMemo(
    () => buildTypingPreviewTokens(normalizedExpectedText, enrollTyped),
    [normalizedExpectedText, enrollTyped]
  );
  const verifyPreviewTokens = useMemo(
    () => buildTypingPreviewTokens(verifyExpectedText, verifyTyped),
    [verifyExpectedText, verifyTyped]
  );
  const enrollDraftHasError = useMemo(
    () => hasTypingPreviewError(enrollPreviewTokens),
    [enrollPreviewTokens]
  );
  const verifyDraftHasError = useMemo(
    () => hasTypingPreviewError(verifyPreviewTokens),
    [verifyPreviewTokens]
  );

  const refreshEnrollCapture = (): void => {
    const recorder = enrollRecorderRef.current;
    setEnrollCapture({
      complete: recorder.isComplete(),
      invalidReason: recorder.getInvalidReason(),
    });
  };

  const refreshVerifyCapture = (): void => {
    const recorder = verifyRecorderRef.current;
    setVerifyCapture({
      complete: recorder.isComplete(),
      invalidReason: recorder.getInvalidReason(),
    });
  };

  const resetEnrollCapture = (options?: ResetCaptureOptions): void => {
    enrollRecorderRef.current = createFixedTextKeystrokeRecorder(normalizedExpectedText);
    pendingEnrollSpaceSubmitRef.current = false;
    if (!options?.preserveSpaceKeyupSkip) {
      skipEnrollSpaceKeyupRef.current = false;
    }
    setEnrollTyped("");
    setEnrollError(null);
    refreshEnrollCapture();
    if (options?.focus !== false) {
      focusTypingInputSoon(enrollInputRef);
    }
  };

  const resetVerifyCaptureForText = (text: string, options?: ResetCaptureOptions): void => {
    verifyRecorderRef.current = createFixedTextKeystrokeRecorder(text);
    pendingVerifySpaceSubmitRef.current = false;
    if (!options?.preserveSpaceKeyupSkip) {
      skipVerifySpaceKeyupRef.current = false;
    }
    setVerifyTyped("");
    setVerifyError(null);
    refreshVerifyCapture();
    if (options?.focus !== false) {
      focusTypingInputSoon(verifyInputRef);
    }
  };

  const resetVerifyCapture = (options?: ResetCaptureOptions): void => {
    resetVerifyCaptureForText(verifyExpectedText, options);
  };

  const startVerificationRound = (): void => {
    if (activeTemplate === null || enrollmentMode) {
      setVerifyError("Bu kisi klavye icin kayitli degil. Once kayit olmasi gerekiyor.");
      return;
    }

    setVerifyResult(null);
    resetVerifyCaptureForText(activeTemplate.expectedText);
  };

  const refreshFixedTextUsers = useCallback(async () => {
    try {
      const response = await client.listUsers();
      const backendUsers = response.users.map((user) => ({
        value: user.userId,
        label: formatUserLabel(user.userId),
      }));
      const nextUsers = mergeFixedTextUsers(DEFAULT_FIXED_TEXT_USERS, backendUsers);

      setFixedTextUsers(nextUsers);
      setUserListError(null);
      setUserId((current) => {
        const normalized = normalizeUserIdInput(current);
        return nextUsers.some((user) => user.value === normalized)
          ? normalized
          : nextUsers[0]?.value ?? normalized;
      });
    } catch (usersError) {
      setFixedTextUsers((current) => mergeFixedTextUsers(DEFAULT_FIXED_TEXT_USERS, current));
      setUserListError(formatSecureKitError(usersError, baseUrl));
    }
  }, [baseUrl, client]);

  useEffect(() => {
    void refreshFixedTextUsers();
  }, [refreshFixedTextUsers]);

  useEffect(() => {
    if (enrollmentMode) return;

    const normalizedUserId = normalizeUserIdInput(userId);
    const normalizedTextId = textId.trim();
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;

    if (!normalizedUserId || !normalizedTextId) {
      setTemplateStatus({
        ...EMPTY_TEMPLATE_STATUS,
        state: "unknown",
        error: "Klavye durumu için kullanıcı ve textId gerekli.",
      });
      setActiveTemplate(null);
      return;
    }

    setTemplateStatus(EMPTY_TEMPLATE_STATUS);
    setActiveTemplate(null);
    setVerifyResult(null);

    const params = new URLSearchParams({
      userId: normalizedUserId,
      textId: normalizedTextId,
    });

    void getSecureKitJson<FixedTextStatusResponse>(
      `/keystroke/status?${params.toString()}`,
      baseUrl
    )
      .then((response) => {
        if (statusRequestIdRef.current !== requestId) return;

        if (response.registered && response.template) {
          const nextTemplate = {
            userId: response.userId,
            textId: response.textId,
            expectedText: response.template.expectedText,
            sampleCount: response.template.sampleCount,
            updatedAt: response.template.updatedAt,
          };

          setUserId(response.userId);
          setTextId(response.textId);
          setExpectedText(response.template.expectedText);
          setActiveTemplate(nextTemplate);
          setTemplateStatus({
            state: "registered",
            sampleCount: response.template.sampleCount,
            updatedAt: response.template.updatedAt,
            error: null,
          });
          resetVerifyCaptureForText(response.template.expectedText, { focus: false });
          return;
        }

        setTemplateStatus({
          state: "unregistered",
          sampleCount: 0,
          updatedAt: null,
          error: null,
        });
      })
      .catch((statusError) => {
        if (statusRequestIdRef.current !== requestId) return;
        setTemplateStatus({
          ...EMPTY_TEMPLATE_STATUS,
          state: "unknown",
          error: formatFixedTextError(statusError, baseUrl),
        });
        setActiveTemplate(null);
      });
  }, [baseUrl, enrollmentMode, textId, userId]);

  useEffect(() => {
    if (activeTemplate !== null) return;

    enrollRecorderRef.current = createFixedTextKeystrokeRecorder(normalizedExpectedText);
    verifyRecorderRef.current = createFixedTextKeystrokeRecorder(normalizedExpectedText);
    skipEnrollSpaceKeyupRef.current = false;
    skipVerifySpaceKeyupRef.current = false;
    pendingEnrollSpaceSubmitRef.current = false;
    pendingVerifySpaceSubmitRef.current = false;

    setEnrollTyped("");
    setVerifyTyped("");
    setEnrollError(null);
    setVerifyError(null);
    setEnrollSamples([]);
    setLastSample(null);
    setEnrollResult(null);
    setVerifyResult(null);

    refreshEnrollCapture();
    refreshVerifyCapture();
  }, [activeTemplate, normalizedExpectedText]);

  const handleFixedTextUserChange = (nextUserId: string): void => {
    setEnrollmentMode(false);
    setAddUserMessage(null);
    setUserId(normalizeUserIdInput(nextUserId));
    setEnrollResult(null);
    setVerifyResult(null);
  };

  const handleAddFixedTextUser = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const normalizedUserId = normalizeUserIdInput(newUserId);

      setAddUserMessage(null);
      if (!isValidUserId(normalizedUserId)) {
        setEnrollError(
          "Kullanıcı ID 2-32 karakter olmalı; küçük harf, rakam, nokta, tire veya alt çizgi kullanın."
        );
        return;
      }

      setAddingUser(true);
      setEnrollError(null);

      try {
        const response = await client.register({
          userId: normalizedUserId,
          password: normalizedUserId,
        });
        const nextUser = {
          value: response.userId,
          label: formatUserLabel(response.userId),
        };

        setFixedTextUsers((current) =>
          mergeFixedTextUsers(DEFAULT_FIXED_TEXT_USERS, current, [nextUser])
        );
        setEnrollmentMode(false);
        setUserId(response.userId);
        setNewUserId("");
        setAddUserMessage(response.created ? "Kişi eklendi ve seçildi." : "Kişi seçildi.");
        void refreshFixedTextUsers();
      } catch (addError) {
        setEnrollError(formatSecureKitError(addError, baseUrl));
      } finally {
        setAddingUser(false);
      }
    },
    [baseUrl, client, newUserId, refreshFixedTextUsers]
  );

  const addEnrollmentSample = (options?: AddEnrollmentSampleOptions): FixedTextKeystrokeSample | null => {
    const normalizedTextId = textId.trim();
    if (!normalizedTextId) {
      setEnrollError("textId is required.");
      return null;
    }

    const sample = enrollRecorderRef.current.getSample(normalizedTextId);
    if (!sample) {
      const reason = invalidReasonMessage(enrollCapture.invalidReason);
      setEnrollError(reason ?? "Sample is not complete yet.");
      return null;
    }

    setEnrollSamples((prev) => [...prev, sample]);
    setLastSample(sample);
    setEnrollError(null);
    resetEnrollCapture({
      preserveSpaceKeyupSkip: options?.preserveSpaceKeyupSkip === true,
    });
    return sample;
  };

  const restartEnrollOnInvalid = (reason: FixedTextInvalidReason): void => {
    resetEnrollCapture();
    setEnrollError(invalidAutoRestartMessage(reason));
  };

  const restartVerifyOnInvalid = (reason: FixedTextInvalidReason): void => {
    resetVerifyCapture();
    setVerifyError(invalidAutoRestartMessage(reason));
  };

  const tryAddEnrollmentSampleFromSpace = (): void => {
    if (enrollBusy !== "idle") return;

    if (!enrollRecorderRef.current.isComplete()) {
      pendingEnrollSpaceSubmitRef.current = true;
      return;
    }

    pendingEnrollSpaceSubmitRef.current = false;
    const sample = addEnrollmentSample({
      preserveSpaceKeyupSkip: true,
    });
    if (!sample) return;

    const nextSamples = [...enrollSamples, sample];
    if (nextSamples.length >= targetSamples) {
      void handleEnrollSubmit(nextSamples);
    }
  };

  const trySubmitVerifyFromSpace = (): void => {
    if (verifyBusy !== "idle") return;

    if (!verifyRecorderRef.current.isComplete()) {
      pendingVerifySpaceSubmitRef.current = true;
      return;
    }

    pendingVerifySpaceSubmitRef.current = false;
    void handleVerifySubmit();
  };

  const onEnrollKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (preventNonAppendEdit(event, setEnrollError)) {
      return;
    }

    if (isSubmitSpaceKeydown(event, normalizedExpectedText)) {
      event.preventDefault();
      skipEnrollSpaceKeyupRef.current = true;
      tryAddEnrollmentSampleFromSpace();
      return;
    }

    enrollRecorderRef.current.keydown({
      key: event.key,
      repeat: event.repeat,
    });

    const invalidReason = enrollRecorderRef.current.getInvalidReason();
    if (invalidReason !== null) {
      event.preventDefault();
      restartEnrollOnInvalid(invalidReason);
      return;
    }

    refreshEnrollCapture();
  };

  const onEnrollKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") return;
    if (event.key === " " && skipEnrollSpaceKeyupRef.current) {
      skipEnrollSpaceKeyupRef.current = false;
      return;
    }

    enrollRecorderRef.current.keyup({
      key: event.key,
    });

    const invalidReason = enrollRecorderRef.current.getInvalidReason();
    if (invalidReason !== null) {
      restartEnrollOnInvalid(invalidReason);
      return;
    }

    refreshEnrollCapture();
    if (pendingEnrollSpaceSubmitRef.current) {
      tryAddEnrollmentSampleFromSpace();
    }
  };

  const onVerifyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (preventNonAppendEdit(event, setVerifyError)) {
      return;
    }

    if (isSubmitSpaceKeydown(event, verifyExpectedText)) {
      event.preventDefault();
      skipVerifySpaceKeyupRef.current = true;
      trySubmitVerifyFromSpace();
      return;
    }

    verifyRecorderRef.current.keydown({
      key: event.key,
      repeat: event.repeat,
    });

    const invalidReason = verifyRecorderRef.current.getInvalidReason();
    if (invalidReason !== null) {
      event.preventDefault();
      restartVerifyOnInvalid(invalidReason);
      return;
    }

    refreshVerifyCapture();
  };

  const onVerifyKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") return;
    if (event.key === " " && skipVerifySpaceKeyupRef.current) {
      skipVerifySpaceKeyupRef.current = false;
      return;
    }

    verifyRecorderRef.current.keyup({
      key: event.key,
    });

    const invalidReason = verifyRecorderRef.current.getInvalidReason();
    if (invalidReason !== null) {
      restartVerifyOnInvalid(invalidReason);
      return;
    }

    refreshVerifyCapture();
    if (pendingVerifySpaceSubmitRef.current) {
      trySubmitVerifyFromSpace();
    }
  };

  const handleAddEnrollmentSample = () => {
    addEnrollmentSample();
  };

  const handleStartNewEnrollment = () => {
    statusRequestIdRef.current += 1;
    setEnrollmentMode(true);
    setActiveTemplate(null);
    setTemplateStatus({
      state: "unregistered",
      sampleCount: 0,
      updatedAt: null,
      error: null,
    });
    setEnrollSamples([]);
    setLastSample(null);
    setEnrollResult(null);
    setVerifyResult(null);
    setEnrollError(null);
    setVerifyError(null);
    resetVerifyCaptureForText(normalizedExpectedText, { focus: false });
    resetEnrollCapture();
  };

  const handleEnrollSubmit = async (samplesOverride?: FixedTextKeystrokeSample[]) => {
    const normalizedUserId = normalizeUserIdInput(userId);
    const normalizedTextId = textId.trim();
    const samplesToUse = samplesOverride ?? enrollSamples;

    if (activeTemplate !== null) {
      setEnrollError("Yeni bir klavye metni kaydetmek icin once Yeni kayit baslat.");
      return;
    }
    if (!normalizedUserId) {
      setEnrollError("userId is required.");
      return;
    }
    if (!normalizedTextId) {
      setEnrollError("textId is required.");
      return;
    }
    if (!expectedTextValid) {
      setEnrollError(expectedTextValidationMessage ?? "expectedText is invalid.");
      return;
    }
    if (samplesToUse.length === 0) {
      setEnrollError("Collect at least one valid sample before enrollment.");
      return;
    }

    setEnrollBusy("loading");
    setEnrollError(null);

    try {
      const result = await postSecureKitJson<FixedTextEnrollResponse>(
        "/keystroke/enroll",
        {
          userId: normalizedUserId,
          textId: normalizedTextId,
          expectedText: normalizedExpectedText,
          samples: samplesToUse,
        },
        baseUrl
      );

      const nextTemplate = {
        userId: normalizedUserId,
        textId: normalizedTextId,
        expectedText: normalizedExpectedText,
        sampleCount: result.template.count,
        updatedAt: Date.now(),
      };

      setUserId(normalizedUserId);
      setTextId(normalizedTextId);
      setExpectedText(normalizedExpectedText);
      setActiveTemplate(nextTemplate);
      setEnrollmentMode(false);
      setTemplateStatus({
        state: "registered",
        sampleCount: result.template.count,
        updatedAt: Date.now(),
        error: null,
      });
      setEnrollResult(result);
      setVerifyResult(null);
      resetVerifyCaptureForText(nextTemplate.expectedText);
    } catch (error) {
      setEnrollError(formatFixedTextError(error, baseUrl));
    } finally {
      setEnrollBusy("idle");
    }
  };

  const handleVerifySubmit = async () => {
    if (activeTemplate === null || enrollmentMode || templateStatus.state !== "registered") {
      setVerifyError("Bu kişi klavye için kayıtlı değil. Önce kayıt olması gerekiyor.");
      return;
    }

    const sample = verifyRecorderRef.current.getSample(activeTemplate.textId);
    if (!sample) {
      const reason = invalidReasonMessage(verifyCapture.invalidReason);
      setVerifyError(reason ?? "Verification sample is not complete yet.");
      return;
    }

    setVerifyBusy("loading");
    setVerifyError(null);

    try {
      const result = await postSecureKitJson<FixedTextVerifyResponse>(
        "/keystroke/verify",
        {
          userId: activeTemplate.userId,
          textId: activeTemplate.textId,
          expectedText: activeTemplate.expectedText,
          sample,
          opts: {
            autoEnroll,
          },
        },
        baseUrl
      );

      setVerifyResult(result);
      setLastSample(sample);
      resetVerifyCapture();
    } catch (error) {
      setVerifyError(formatFixedTextError(error, baseUrl));
    } finally {
      setVerifyBusy("idle");
    }
  };

  const userControlsDisabled = enrollBusy !== "idle" || verifyBusy !== "idle" || addingUser;
  const addUserDisabled = userControlsDisabled || !newUserId.trim();
  const canVerifyKeystroke = verificationAvailable && templateStatus.state === "registered";

  return {
    activeTemplate,
    addUserDisabled,
    addUserMessage,
    addingUser,
    autoEnroll,
    baseUrl,
    canVerifyKeystroke,
    enrollBusy,
    enrollCapture,
    enrollDraftHasError,
    enrollError,
    enrollInputRef,
    enrollPreviewTokens,
    enrollResult,
    enrollSamples,
    enrollTyped,
    expectedLength,
    expectedText,
    expectedTextValidationMessage,
    expectedTextWasTrimmed,
    expectedWordCount,
    handleAddEnrollmentSample,
    handleAddFixedTextUser,
    handleEnrollSubmit,
    handleFixedTextUserChange,
    handleStartNewEnrollment,
    handleVerifySubmit,
    lastSample,
    newUserId,
    onEnrollKeyDown,
    onEnrollKeyUp,
    onVerifyKeyDown,
    onVerifyKeyUp,
    resetEnrollCapture,
    resetVerifyCapture,
    startVerificationRound,
    setAutoEnroll,
    setEnrollError,
    setEnrollResult,
    setEnrollSamples,
    setEnrollTyped,
    setExpectedText,
    setNewUserId,
    setTargetSamplesInput,
    setTextId,
    setUserId,
    setVerifyError,
    setVerifyTyped,
    setupLocked,
    targetSamples,
    targetSamplesInput,
    templateStatus,
    templateStatusDetail: templateStatusDetail(templateStatus, enrollmentMode),
    templateStatusLabel: templateStatusLabel(templateStatus, enrollmentMode),
    textId,
    userId,
    userControlsDisabled,
    userListError,
    fixedTextUsers,
    verifyBusy,
    verifyCapture,
    verifyDraftHasError,
    verifyError,
    verifyInputRef,
    verifyPreviewTokens,
    verifyResult,
    verifyTyped,
  };
}

export type FixedTextKeystrokePlaygroundController = ReturnType<
  typeof useFixedTextKeystrokePlaygroundController
>;
