import type { Policy } from "./contracts";

export const DefaultPolicy: Policy = {
  steps: [
    { use: "webauthn:passkey", required: true },
    { use: "face:liveness", required: true, params: { script: ["head_up", "blink"] } },
    { use: "vpn:check", required: false, weight: 0.2 }
  ],
  passScore: 0.8
};
