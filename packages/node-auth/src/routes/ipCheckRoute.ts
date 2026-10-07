// packages/node-auth/src/routes/ipCheckRoute.ts
import express, { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";

const router = express.Router();

// Çalışma dizini repo kökü ise: securekit/python/ip_check.py
const PYTHON_SCRIPT_PATH = path.resolve(process.cwd(), "python/ip_check.py");

interface IpCheckRequestBody {
  expectedCountryCode?: string | null;
}

router.post(
  "/ip-check",
  (req: Request<unknown, unknown, IpCheckRequestBody>, res: Response) => {
    const expectedCountryCode = req.body?.expectedCountryCode ?? null;

    // Client IP
    const xff = req.headers["x-forwarded-for"];
    const clientIp = Array.isArray(xff)
      ? xff[0].split(",")[0].trim()
      : (xff ? xff.split(",")[0].trim() : req.socket.remoteAddress);

    if (!clientIp) {
      return res.status(400).json({ error: "IP not found" });
    }

    const args = expectedCountryCode
      ? [clientIp, expectedCountryCode]
      : [clientIp];

    const py = spawn("python", [PYTHON_SCRIPT_PATH, ...args]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    py.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    py.on("close", (code: number | null) => {
      if (code !== 0) {
        return res.status(500).json({
          error: "Python script error",
          stderr,
          exitCode: code,
        });
      }

      try {
        const json = JSON.parse(stdout);
        return res.json(json);
      } catch (err) {
        return res.status(500).json({
          error: "Failed to parse python output",
          raw: stdout,
        });
      }
    });
  }
);

export const ipCheckRouter = router;
