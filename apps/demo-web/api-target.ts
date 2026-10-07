export function resolveApiTarget(env: Record<string, string | undefined>): string {
  const explicitTarget = env.VITE_SECUREKIT_DEV_PROXY_TARGET?.trim();
  if (explicitTarget) return explicitTarget;
  const backend = env.VITE_SECUREKIT_API_BACKEND?.trim().toLowerCase() || "aspnet";
  if (backend === "aspnet") return "http://localhost:3002";
  if (backend === "node") return "http://localhost:3001";
  throw new Error("VITE_SECUREKIT_API_BACKEND must be aspnet or node.");
}
