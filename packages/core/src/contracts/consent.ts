export type ConsentVersion = string;

export type ConsentLog = {
  userId: string;
  consentVersion: ConsentVersion;
  grantedAt: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type ConsentRequest = {
  userId: string;
  consentVersion: ConsentVersion;
};

export type ConsentResponse = {
  ok: true;
  userId: string;
  consentVersion: ConsentVersion;
  grantedAt: string;
};
