import express, { type Request, type Response } from "express";
import {
  runIpCheck as defaultRunIpCheck,
} from "../services/ipCheck";
import { computeNetworkResult } from "../services/networkScore";
import {
  buildLocationResultFromIpCheck,
  getClientIp,
  LocationCountryResult,
  makeError,
  mapLocationToLegacyResult,
  mapNetworkToLegacyVpnResult,
  parseAllowedCountries,
  parseClientOffsetMin,
  parseLegacyCountryInputs,
  parseMockScenario,
  parseVpnClientMetadata,
  resolveNetworkCheck,
  type RunIpCheckFn,
  type VerificationResult,
  type VpnCheckResultDetails,
} from "./legacy/helpers";

export function createLegacyVerificationRouter(args: {
  runIpCheck?: RunIpCheckFn;
}) {
  const router = express.Router();
  const runIpCheck = args.runIpCheck ?? defaultRunIpCheck;

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.post("/verify/webauthn:passkey", (req: Request, res: Response) => {
    const { proof } = req.body ?? {};
    const ok = !!proof;

    const result: VerificationResult = {
      ok,
      score: ok ? 1 : 0,
    };

    res.json(result);
  });

  router.post("/verify/face:liveness", (req: Request, res: Response) => {
    const { proof, metrics } = req.body ?? {};
    const quality =
      typeof metrics?.quality === "number" && Number.isFinite(metrics.quality)
        ? metrics.quality
        : 0;
    const illuminationOk = metrics?.illuminationOk !== false;
    const ok = proof?.tasksOk === true && quality > 0.8 && illuminationOk;

    const result: VerificationResult = {
      ok,
      score: ok ? 1 : 0,
      details:
        typeof metrics?.illuminationOk === "boolean"
          ? { illuminationOk: metrics.illuminationOk }
          : undefined,
    };

    res.json(result);
  });

  router.post("/verify/network", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const clientOffsetMin = parseClientOffsetMin(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      res.status(400).json(
        makeError({
          code: "IP_NOT_FOUND",
          message: "Client IP could not be determined.",
        })
      );
      return;
    }

    try {
      const { network } = await resolveNetworkCheck({
        ip,
        clientOffsetMin,
        scenario,
        runIpCheck,
      });

      res.json(network);
    } catch (error) {
      res.status(502).json(
        makeError({
          code: "IP_CHECK_FAILED",
          message: "Failed to run IP verification pipeline.",
          details: error instanceof Error ? error.message : error,
        })
      );
    }
  });

  router.post("/verify/location", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowedCountries = parseAllowedCountries(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      res.status(400).json(
        makeError({
          code: "IP_NOT_FOUND",
          message: "Client IP could not be determined.",
        })
      );
      return;
    }

    try {
      const ipCheck = await runIpCheck(ip, { scenario });
      const location = buildLocationResultFromIpCheck({
        ipCheck,
        allowedCountries,
      });

      res.json(location);
    } catch (error) {
      res.status(502).json(
        makeError({
          code: "IP_CHECK_FAILED",
          message: "Failed to run IP verification pipeline.",
          details: error instanceof Error ? error.message : error,
        })
      );
    }
  });

  router.post("/verify/vpn:check", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const clientMeta = parseVpnClientMetadata(req);

    if (!ip) {
      const result: VerificationResult & { details: VpnCheckResultDetails } = {
        ok: false,
        score: 0,
        details: {
          ip: null,
          ipTimeZone: null,
          ipCountry: null,
          ipRegion: null,
          isVpn: false,
          isProxy: false,
          isTor: false,
          isRelay: false,
          timezoneDriftHours: null,
          clientTimeZone: clientMeta.clientTimeZone,
          clientTimeOffsetMinutes: clientMeta.clientTimeOffsetMinutes,
          source: "ip_missing",
          ipInfo: null,
        },
      };

      res.status(400).json(result);
      return;
    }

    try {
      const { ipCheck, network } = await resolveNetworkCheck({
        ip,
        clientOffsetMin: clientMeta.clientTimeOffsetMinutes,
        runIpCheck,
      });

      const result = mapNetworkToLegacyVpnResult({
        network,
        ipCheck,
        clientMeta,
      });

      res.json(result);
    } catch (_error) {
      const details: VpnCheckResultDetails = {
        ip,
        ipTimeZone: null,
        ipCountry: null,
        ipRegion: null,
        isVpn: false,
        isProxy: false,
        isTor: false,
        isRelay: false,
        timezoneDriftHours: null,
        clientTimeZone: clientMeta.clientTimeZone,
        clientTimeOffsetMinutes: clientMeta.clientTimeOffsetMinutes,
        source: "ip_check_failed",
        ipInfo: null,
      };

      res.status(500).json({
        ok: false,
        score: 0,
        details,
      } satisfies VerificationResult & { details: VpnCheckResultDetails });
    }
  });

  router.post("/verify/location:country", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const { expectedCountryCode, clientCountryCode } = parseLegacyCountryInputs(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      const result: LocationCountryResult = {
        ok: false,
        score: 0,
        ipCountryCode: null,
        expectedCountryCode,
        clientCountryCode,
        details: {
          ip: null,
          ipCountryCode: null,
          expectedCountryCode,
          clientCountryCode,
          matchesExpectedCountry: null,
          matchesClientCountry: null,
          reason: "no_ip",
          ipInfo: null,
          security: {
            vpn: null,
            proxy: null,
            tor: null,
            relay: null,
          },
        },
      };

      res.status(400).json(result);
      return;
    }

    try {
      const allowedCountries = expectedCountryCode
        ? [expectedCountryCode]
        : clientCountryCode
          ? [clientCountryCode]
          : undefined;

      const ipCheck = await runIpCheck(ip, {
        expectedCountryCode: expectedCountryCode ?? clientCountryCode,
        scenario,
      });

      const location = buildLocationResultFromIpCheck({
        ipCheck,
        allowedCountries,
      });

      const network = computeNetworkResult(ipCheck, parseClientOffsetMin(req.body), ip);
      const result = mapLocationToLegacyResult({
        ip,
        location,
        network,
        ipCheck,
        expectedCountryCode,
        clientCountryCode,
      });

      res.json(result);
    } catch (_error) {
      const result: LocationCountryResult = {
        ok: false,
        score: 0,
        ipCountryCode: null,
        expectedCountryCode,
        clientCountryCode,
        details: {
          ip,
          ipCountryCode: null,
          expectedCountryCode,
          clientCountryCode,
          matchesExpectedCountry: null,
          matchesClientCountry: null,
          reason: "ip_check_failed",
          ipInfo: null,
          security: {
            vpn: null,
            proxy: null,
            tor: null,
            relay: null,
          },
        },
      };

      res.status(500).json(result);
    }
  });

  return router;
}
