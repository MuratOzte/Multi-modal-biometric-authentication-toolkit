export type VerifyError = {
  code: string;
  message: string;
  details?: unknown;
};

export type NetworkFlags = {
  vpn?: boolean;
  proxy?: boolean;
  tor?: boolean;
  relay?: boolean;
  hosting?: boolean;
  mobile?: boolean;
  suspicious?: boolean;
};

export type NetworkIpInfo = {
  ip: string;
  countryCode?: string | null;
  timezoneOffsetMin?: number | null;
  clientOffsetMin?: number | null;
  driftMin?: number | null;
};

export type NetworkResult = {
  ok: boolean;
  score: number;
  flags: NetworkFlags;
  reasons: string[];
  ipInfo: NetworkIpInfo;
  raw?: unknown;
};

export type LocationResult = {
  ok: boolean;
  countryCode?: string | null;
  allowed: boolean;
  reasons: string[];
};
