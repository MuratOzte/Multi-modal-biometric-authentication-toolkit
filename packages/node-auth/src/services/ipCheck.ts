import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type IpCheckSecurity = {
  vpn?: boolean | null;
  proxy?: boolean | null;
  tor?: boolean | null;
  relay?: boolean | null;
  hosting?: boolean | null;
  mobile?: boolean | null;
  suspicious?: boolean | null;
};

export type IpCheckLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
  time_zone?: string | null;
  utc_offset_minutes?: number | null;
};

export type IpCheckInfo = {
  ip?: string | null;
  security?: IpCheckSecurity | null;
  location?: IpCheckLocation | null;
  network?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type IpCheckOutput = {
  same_country?: boolean | null;
  ip_country_code?: string | null;
  expected_country_code?: string | null;
  ip_info?: IpCheckInfo | null;
  [key: string]: unknown;
};

export type RunIpCheckParams = {
  clientOffsetMin?: number | null;
  expectedCountryCode?: string | null;
  scenario?: "clean" | "risky";
};

const MOCK_CLEAN_FIXTURE: IpCheckOutput = {
  same_country: null,
  ip_country_code: "TR",
  expected_country_code: null,
  ip_info: {
    ip: "8.8.8.8",
    security: {
      vpn: false,
      proxy: false,
      tor: false,
      relay: false,
      hosting: false,
      mobile: false,
      suspicious: false,
    },
    location: {
      city: "Istanbul",
      region: "Istanbul",
      country: "Turkey",
      country_code: "TR",
      time_zone: "Europe/Istanbul",
      utc_offset_minutes: 180,
    },
    network: {
      asn: 15169,
      network: "8.8.8.0/24",
    },
  },
};

const MOCK_RISKY_FIXTURE: IpCheckOutput = {
  same_country: null,
  ip_country_code: "RU",
  expected_country_code: null,
  ip_info: {
    ip: "1.1.1.1",
    security: {
      vpn: true,
      proxy: true,
      tor: true,
      relay: true,
      hosting: true,
      mobile: false,
      suspicious: true,
    },
    location: {
      city: "Moscow",
      region: "Moscow",
      country: "Russia",
      country_code: "RU",
      time_zone: "UTC",
      utc_offset_minutes: 0,
    },
    network: {
      asn: 64512,
      network: "1.1.1.0/24",
    },
  },
};

function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function isMockIpCheckEnabled(): boolean {
  return process.env.MOCK_IP_CHECK === "1";
}

function resolveMockScenario(params: RunIpCheckParams): "clean" | "risky" {
  return params.scenario === "risky" ? "risky" : "clean";
}

function buildMockResponse(ip: string, params: RunIpCheckParams): IpCheckOutput {
  const fixture = resolveMockScenario(params) === "risky" ? MOCK_RISKY_FIXTURE : MOCK_CLEAN_FIXTURE;
  const expectedCountryCode = normalizeCountryCode(params.expectedCountryCode);
  const ipCountryCode = normalizeCountryCode(fixture.ip_country_code);
  const sameCountry =
    expectedCountryCode && ipCountryCode ? expectedCountryCode === ipCountryCode : null;

  return {
    ...fixture,
    same_country: sameCountry,
    expected_country_code: expectedCountryCode,
    ip_info: fixture.ip_info
      ? {
          ...fixture.ip_info,
          ip,
        }
      : fixture.ip_info,
  };
}

export async function runIpCheck(
  ip: string,
  params: RunIpCheckParams = {}
): Promise<IpCheckOutput> {
  if (isMockIpCheckEnabled()) {
    return buildMockResponse(ip, params);
  }

  const projectRoot = path.resolve(__dirname, "../../../../");
  const scriptPath = path.join(projectRoot, "python", "ip_check.py");

  const args = [scriptPath, ip];
  if (params.expectedCountryCode) {
    args.push(params.expectedCountryCode);
  }

  const pythonCommand =
    process.env.PYTHON_CMD || (process.platform === "win32" ? "py" : "python3");

  return new Promise<IpCheckOutput>((resolve, reject) => {
    const proc = spawn(pythonCommand, args, {
      cwd: path.dirname(scriptPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ip_check.py exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as IpCheckOutput;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}
