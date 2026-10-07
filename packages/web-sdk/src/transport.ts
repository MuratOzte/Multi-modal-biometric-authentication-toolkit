import type { ChallengeRunContext, Transport } from "@securekit/core";

export type FetchLike = typeof fetch;

export class HttpError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface HttpTransportOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("A fetch implementation is required.");
    }
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`);
    return this.handleResponse<T>(response);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  async postFormData<T>(path: string, formData: FormData): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      body: formData,
    });

    return this.handleResponse<T>(response);
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
      throw new HttpError(response.status, message, payload);
    }

    return payload as T;
  }
}

export function httpTransport(baseUrl: string, fetchImpl?: FetchLike): Transport {
  const transport = new HttpTransport({ baseUrl, fetchImpl });

  return {
    async verify(
      use: string,
      payload: { proof: unknown; metrics?: unknown; context: ChallengeRunContext }
    ) {
      try {
        return await transport.post(`/verify/${encodeURIComponent(use)}`, payload);
      } catch (error) {
        if (error instanceof HttpError) {
          return { ok: false, error: `HTTP ${error.status}` };
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown transport error",
        };
      }
    },
  };
}
