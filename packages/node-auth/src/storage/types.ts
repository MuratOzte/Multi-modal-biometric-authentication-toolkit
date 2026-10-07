import type {
  ConsentLog,
  KeystrokeProfile,
  UserProfiles,
  VoiceEnrollmentProfile,
} from "@securekit/core";

export type { ConsentLog, KeystrokeProfile, UserProfiles, VoiceEnrollmentProfile };

export type StoredUserData = {
  profiles: UserProfiles | null;
  consentLogs: ConsentLog[];
};
