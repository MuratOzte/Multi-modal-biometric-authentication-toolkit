import type { LocationResult } from "@securekit/core";

function getAllowedCountryFromNavigator(): string | null {
  if (typeof navigator === "undefined") return null;

  const lang = navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage;
  if (!lang) return null;

  const parts = lang.split("-");
  if (parts.length > 1 && parts[1]) {
    return parts[1].toUpperCase();
  }

  if (parts[0] && parts[0].length === 2) {
    return parts[0].toUpperCase();
  }

  return null;
}

const NODE_AUTH_BASE_URL = "http://localhost:3001";

export async function verifyLocationCountry(): Promise<LocationResult> {
  const country = getAllowedCountryFromNavigator();

  const res = await fetch(`${NODE_AUTH_BASE_URL}/verify/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowedCountries: country ? [country] : undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`verifyLocationCountry failed: ${res.status}`);
  }

  return (await res.json()) as LocationResult;
}
