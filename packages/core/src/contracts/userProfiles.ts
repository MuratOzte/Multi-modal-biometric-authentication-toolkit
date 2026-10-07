import type { KeystrokeProfile } from "./enrollment";
import type { VoiceEnrollmentProfile } from "./voice";

export type FaceEnrollmentProfile = {
  embedding: number[];
};

export type UserProfiles = {
  userId: string;
  keystroke?: KeystrokeProfile | null;
  faceReferenceImagePath?: string | null;
  faceReferenceEnrolledAt?: string | null;
  faceEmbedding?: number[] | null;
  cardReferenceImagePath?: string | null;
  cardReferenceEnrolledAt?: string | null;
  voice?: VoiceEnrollmentProfile | null;
  voiceEmbedding?: number[] | null;
  updatedAt: string;
};

export type DeleteBiometricsRequest = {
  userId: string;
};

export type DeleteBiometricsResponse = {
  ok: true;
  userId: string;
};

export type GetProfilesResponse = {
  ok: true;
  profiles: UserProfiles;
};
