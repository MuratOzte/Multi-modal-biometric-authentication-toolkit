import type {
  ChallengeTextRequest,
  ChallengeTextResponse,
  ConsentRequest,
  ConsentResponse,
  CardEnrollmentReferenceResponse,
  CardReferencesResponse,
  CardVerificationResult,
  DeleteBiometricsResponse,
  EnrollKeystrokeRequest,
  EnrollKeystrokeResponse,
  FaceEnrollmentReferenceResponse,
  FaceSlidingWindowVerificationResult,
  FaceVerificationResult as CoreFaceVerificationResult,
  GetProfilesResponse,
  LocationResult,
  NetworkResult,
  SessionStartResponse,
  VerifyKeystrokeRequest,
  VerifyKeystrokeResponse,
  VerifySessionRequest,
  VerifySessionResponse,
  VoiceEnrollmentResponse,
  VoiceVerificationResult,
} from "@securekit/core";
import { HttpError, HttpTransport } from "./transport";
import {
  buildLegacyVpnResult,
  buildLocationCountryResult,
  evaluateLocationPolicy,
  evaluateVpnPolicy,
  getClientOffsetMin,
  getClientTimeZone,
  getNavigatorCountryCode,
  normalizeCountryCode,
} from "./client.legacy";
import type {
  EnrollFaceReferenceArgs,
  EnrollVoiceArgs,
  AuthCredentials,
  AuthLoginResponse,
  AuthRegisterResponse,
  AuthUsersResponse,
  LocationPolicyConfig,
  LocationVerificationWithDecision,
  SecureKitClientOptions,
  VerificationResult,
  EnrollCardReferenceArgs,
  VerifyFaceArgs,
  VerifyFaceLivenessPayload,
  VerifyFaceSlidingWindowArgs,
  VerifyCardArgs,
  VerifyVoiceArgs,
  VerifyLocationOptions,
  VerifyNetworkOptions,
  VpnPolicyConfig,
  VpnVerificationWithDecision,
} from "./client.types";

export class SecureKitClient {
  private readonly transport: HttpTransport;
  private readonly vpnPolicy?: VpnPolicyConfig;
  private readonly locationPolicy?: LocationPolicyConfig;

  constructor(options: SecureKitClientOptions) {
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
    });
    this.vpnPolicy = options.vpnPolicy;
    this.locationPolicy = options.locationPolicy;
  }

  async health(): Promise<{ ok: boolean }> {
    return this.transport.get<{ ok: boolean }>("/health");
  }

  async register(args: AuthCredentials): Promise<AuthRegisterResponse> {
    return this.transport.post<AuthRegisterResponse>("/auth/register", {
      userId: args.userId,
      password: args.password,
    });
  }

  async login(args: AuthCredentials): Promise<AuthLoginResponse> {
    return this.transport.post<AuthLoginResponse>("/auth/login", {
      userId: args.userId,
      password: args.password,
    });
  }

  async listUsers(): Promise<AuthUsersResponse> {
    return this.transport.get<AuthUsersResponse>("/auth/users");
  }

  async verifyNetwork(options: VerifyNetworkOptions = {}): Promise<NetworkResult> {
    const clientOffsetMin =
      typeof options.clientOffsetMin === "number" ? options.clientOffsetMin : getClientOffsetMin();

    return this.transport.post<NetworkResult>("/verify/network", {
      clientOffsetMin,
    });
  }

  async verifyLocation(options: VerifyLocationOptions = {}): Promise<LocationResult> {
    const body = options.allowedCountries ? { allowedCountries: options.allowedCountries } : {};
    return this.transport.post<LocationResult>("/verify/location", body);
  }

  async getTextChallenge(options: ChallengeTextRequest = {}): Promise<ChallengeTextResponse> {
    return this.transport.post<ChallengeTextResponse>("/challenge/text", {
      lang: options.lang,
      length: options.length,
      wordCount: options.wordCount,
      sessionId: options.sessionId,
      text: options.text,
    });
  }

  async startSession(): Promise<SessionStartResponse> {
    return this.transport.post<SessionStartResponse>("/session/start");
  }

  async verifySession(args: VerifySessionRequest): Promise<VerifySessionResponse> {
    return this.transport.post<VerifySessionResponse>("/verify/session", args);
  }

  async grantConsent(args: ConsentRequest): Promise<ConsentResponse> {
    return this.transport.post<ConsentResponse>("/consent", args);
  }

  async enrollKeystroke(args: EnrollKeystrokeRequest): Promise<EnrollKeystrokeResponse> {
    return this.transport.post<EnrollKeystrokeResponse>("/enroll/keystroke", args);
  }

  async verifyKeystroke(args: VerifyKeystrokeRequest): Promise<VerifyKeystrokeResponse> {
    return this.transport.post<VerifyKeystrokeResponse>("/verify/keystroke", args);
  }

  async enrollFaceReference(
    args: EnrollFaceReferenceArgs
  ): Promise<FaceEnrollmentReferenceResponse> {
    const userId = args.userId.trim();
    if (!userId) {
      throw new Error("userId is required for face reference enrollment.");
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append(
      "referenceImage",
      args.referenceImage,
      args.referenceFileName ?? "reference.jpg"
    );

    return this.transport.postFormData<FaceEnrollmentReferenceResponse>(
      "/enroll/face/reference",
      formData
    );
  }

  async verifyFace(args: VerifyFaceArgs): Promise<CoreFaceVerificationResult> {
    if (!(args.probeImage instanceof Blob)) {
      throw new Error("verifyFace requires probeImage.");
    }

    const hasUserId = typeof args.userId === "string" && args.userId.trim().length > 0;
    const hasReferencePath =
      typeof args.referenceImagePath === "string" && args.referenceImagePath.trim().length > 0;
    const hasReferenceImage = args.referenceImage instanceof Blob;

    if (!hasUserId && !hasReferencePath && !hasReferenceImage) {
      throw new Error(
        "verifyFace requires one reference source: userId, referenceImagePath, or referenceImage."
      );
    }

    const formData = new FormData();
    formData.append("probeImage", args.probeImage, args.probeFileName ?? "probe.jpg");

    if (hasUserId) {
      formData.append("userId", args.userId!.trim());
    }
    if (hasReferencePath) {
      formData.append("referenceImagePath", args.referenceImagePath!.trim());
    }
    if (hasReferenceImage && args.referenceImage) {
      formData.append(
        "referenceImage",
        args.referenceImage,
        args.referenceFileName ?? "reference.jpg"
      );
    }
    if (typeof args.threshold === "number") {
      formData.append("threshold", String(args.threshold));
    }

    return this.transport.postFormData<CoreFaceVerificationResult>("/verify/face", formData);
  }

  async verifyFaceSlidingWindow(
    args: VerifyFaceSlidingWindowArgs
  ): Promise<FaceSlidingWindowVerificationResult> {
    if (!(args.probeImage instanceof Blob)) {
      throw new Error("verifyFaceSlidingWindow requires probeImage.");
    }

    const userId = args.userId.trim();
    if (!userId) {
      throw new Error("verifyFaceSlidingWindow requires userId.");
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("probeImage", args.probeImage, args.probeFileName ?? "probe.jpg");

    if (typeof args.threshold === "number") {
      formData.append("threshold", String(args.threshold));
    }
    if (typeof args.maxWindow === "number") {
      formData.append("maxWindow", String(args.maxWindow));
    }
    if (typeof args.updateOnSuccess === "boolean") {
      formData.append("updateOnSuccess", String(args.updateOnSuccess));
    }

    return this.transport.postFormData<FaceSlidingWindowVerificationResult>(
      "/verify/face-sliding",
      formData
    );
  }

  async listCardReferences(): Promise<CardReferencesResponse> {
    return this.transport.get<CardReferencesResponse>("/card/references");
  }

  async enrollCardReference(
    args: EnrollCardReferenceArgs
  ): Promise<CardEnrollmentReferenceResponse> {
    const userId = args.userId.trim();
    if (!userId) {
      throw new Error("userId is required for card reference enrollment.");
    }
    if (!(args.referenceImage instanceof Blob)) {
      throw new Error("enrollCardReference requires referenceImage.");
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append(
      "referenceImage",
      args.referenceImage,
      args.referenceFileName ?? "card-reference.jpg"
    );

    return this.transport.postFormData<CardEnrollmentReferenceResponse>(
      "/enroll/card/reference",
      formData
    );
  }

  async verifyCard(args: VerifyCardArgs): Promise<CardVerificationResult> {
    if (!(args.probeImage instanceof Blob)) {
      throw new Error("verifyCard requires probeImage.");
    }

    const formData = new FormData();
    formData.append("probeImage", args.probeImage, args.probeFileName ?? "card-capture.jpg");

    if (typeof args.userId === "string" && args.userId.trim().length > 0) {
      formData.append("userId", args.userId.trim());
    }
    if (typeof args.referenceId === "string" && args.referenceId.trim().length > 0) {
      formData.append("referenceId", args.referenceId.trim());
    }
    if (typeof args.threshold === "number") {
      formData.append("threshold", String(args.threshold));
    }

    return this.transport.postFormData<CardVerificationResult>("/verify/card", formData);
  }

  async enrollVoice(args: EnrollVoiceArgs): Promise<VoiceEnrollmentResponse> {
    const userId = args.userId.trim();
    const challengeId = args.challengeId.trim();
    if (!userId) {
      throw new Error("userId is required for voice enrollment.");
    }
    if (!challengeId) {
      throw new Error("challengeId is required for voice enrollment.");
    }
    if (!(args.audioSample instanceof Blob)) {
      throw new Error("enrollVoice requires audioSample.");
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("challengeId", challengeId);
    formData.append("audioSample", args.audioSample, args.audioFileName ?? "voice.webm");

    if (typeof args.sessionId === "string" && args.sessionId.trim().length > 0) {
      formData.append("sessionId", args.sessionId.trim());
    }
    if (typeof args.transcriptThreshold === "number") {
      formData.append("transcriptThreshold", String(args.transcriptThreshold));
    }
    if (typeof args.minEnrollmentSamples === "number") {
      formData.append("minEnrollmentSamples", String(args.minEnrollmentSamples));
    }

    return this.transport.postFormData<VoiceEnrollmentResponse>("/enroll/voice", formData);
  }

  async verifyVoice(args: VerifyVoiceArgs): Promise<VoiceVerificationResult> {
    const userId = args.userId.trim();
    const challengeId = args.challengeId.trim();
    if (!userId) {
      throw new Error("userId is required for voice verification.");
    }
    if (!challengeId) {
      throw new Error("challengeId is required for voice verification.");
    }
    if (!(args.audioSample instanceof Blob)) {
      throw new Error("verifyVoice requires audioSample.");
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("challengeId", challengeId);
    formData.append("audioSample", args.audioSample, args.audioFileName ?? "voice.webm");

    if (typeof args.sessionId === "string" && args.sessionId.trim().length > 0) {
      formData.append("sessionId", args.sessionId.trim());
    }
    if (typeof args.matchThreshold === "number") {
      formData.append("matchThreshold", String(args.matchThreshold));
    }
    if (typeof args.stepUpThreshold === "number") {
      formData.append("stepUpThreshold", String(args.stepUpThreshold));
    }
    if (typeof args.denyThreshold === "number") {
      formData.append("denyThreshold", String(args.denyThreshold));
    }
    if (typeof args.transcriptThreshold === "number") {
      formData.append("transcriptThreshold", String(args.transcriptThreshold));
    }
    if (typeof args.updateProfileOnAllow === "boolean") {
      formData.append("updateProfileOnAllow", String(args.updateProfileOnAllow));
    }
    if (typeof args.profileUpdateAlpha === "number") {
      formData.append("profileUpdateAlpha", String(args.profileUpdateAlpha));
    }

    return this.transport.postFormData<VoiceVerificationResult>("/verify/voice", formData);
  }

  async getProfiles(userId: string): Promise<GetProfilesResponse> {
    return this.transport.get<GetProfilesResponse>(`/user/${encodeURIComponent(userId)}/profiles`);
  }

  async deleteBiometrics(userId: string): Promise<DeleteBiometricsResponse> {
    return this.transport.delete<DeleteBiometricsResponse>("/user/biometrics", {
      userId,
    });
  }

  /** @deprecated Use verifyNetwork instead. */
  async verifyVpn() {
    const clientTimeZone = getClientTimeZone();
    const clientTimeOffsetMinutes = getClientOffsetMin();
    const network = await this.verifyNetwork({ clientOffsetMin: clientTimeOffsetMinutes });
    return buildLegacyVpnResult({
      network,
      clientTimeZone,
      clientTimeOffsetMinutes,
    });
  }

  async verifyVpnWithPolicy(
    policyOverride?: VpnPolicyConfig
  ): Promise<VpnVerificationWithDecision> {
    const raw = await this.verifyVpn();
    const decision = evaluateVpnPolicy(raw, {
      ...(this.vpnPolicy ?? {}),
      ...(policyOverride ?? {}),
    });
    return { raw, decision };
  }

  /** @deprecated Use verifyLocation instead. */
  async verifyLocationCountryAuto(): Promise<import("./client.types").LocationCountryResult> {
    const autoCountry = getNavigatorCountryCode();
    return this.verifyLocationCountry(autoCountry ?? undefined);
  }

  /** @deprecated Use verifyLocation instead. */
  async verifyLocationCountry(
    expectedCountryCode?: string
  ): Promise<import("./client.types").LocationCountryResult> {
    const normalizedExpected = normalizeCountryCode(expectedCountryCode ?? null);
    const normalizedClient = normalizeCountryCode(getNavigatorCountryCode());
    const allowedCountries = normalizedExpected
      ? [normalizedExpected]
      : normalizedClient
        ? [normalizedClient]
        : undefined;

    const [location, network] = await Promise.all([
      this.verifyLocation({ allowedCountries }),
      this.verifyNetwork(),
    ]);

    return buildLocationCountryResult({
      location,
      network,
      expectedCountryCode: normalizedExpected,
      clientCountryCode: normalizedClient,
    });
  }

  async verifyLocationCountryWithPolicy(
    expectedCountryCode?: string,
    policyOverride?: LocationPolicyConfig
  ): Promise<LocationVerificationWithDecision> {
    const raw = await this.verifyLocationCountry(expectedCountryCode);
    const decision = evaluateLocationPolicy(raw, {
      ...(this.locationPolicy ?? {}),
      ...(policyOverride ?? {}),
    });
    return { raw, decision };
  }

  async verifyPasskey(proof: unknown): Promise<VerificationResult> {
    try {
      return await this.transport.post<VerificationResult>("/verify/webauthn:passkey", { proof });
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(`Passkey verify failed: ${error.status}`);
      }
      throw error;
    }
  }

  async verifyFaceLiveness(payload: VerifyFaceLivenessPayload): Promise<VerificationResult> {
    try {
      return await this.transport.post<VerificationResult>("/verify/face:liveness", payload);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(`Face liveness failed: ${error.status}`);
      }
      throw error;
    }
  }
}
