import { describe, expect, it, vi } from "vitest";
import type {
  CardEnrollmentReferenceResponse,
  CardReferencesResponse,
  CardVerificationResult,
} from "@securekit/core";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient card methods", () => {
  it("listCardReferences gets registered card references", async () => {
    const fixture: CardReferencesResponse = {
      ok: true,
      referenceDir: "/tmp/cards",
      references: [
        {
          id: "mert.png",
          fileName: "mert.png",
          label: "mert",
          imagePath: "/tmp/cards/mert.png",
        },
      ],
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.listCardReferences();

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("http://localhost:3001/card/references");
    expect(init).toBeUndefined();
  });

  it("verifyCard posts multipart form data to /verify/card", async () => {
    const fixture: CardVerificationResult = {
      ok: true,
      matched: true,
      threshold: 0.7,
      checkedCount: 1,
      reason: null,
      bestMatch: {
        referenceImagePath: "/tmp/cards/mert.png",
        referenceFileName: "mert.png",
        decision: "same",
        overallScore: 0.91,
        contentScore: 1,
        visualScore: 0.75,
        visualDetails: {
          activeMethod: "clip",
          clipScore: 0.75,
          clipCosine: 0.75,
          clipAvailable: true,
          clipModel: "ViT-B-32/laion2b_s34b_b79k",
          clipDevice: "cuda",
          clipError: null,
        },
        reasons: [],
        fields: {
          probe: {
            name: "MERT",
            studentNo: "123",
            documentNo: "TR1234567",
            cardNo: "456",
            validThru: "09/26",
          },
          reference: {
            name: "MERT",
            studentNo: "123",
            documentNo: "TR1234567",
            cardNo: "456",
            validThru: "09/26",
          },
        },
        quality: {
          cardDetectedProbe: true,
          cardDetectedReference: true,
          detectionConfidenceProbe: 84.01,
          detectionConfidenceReference: 60.07,
          ocrAvailable: true,
          ocrWeak: false,
          ocrErrorProbe: null,
          ocrErrorReference: null,
        },
        matched: true,
      },
      candidates: [],
    };

    fixture.candidates = fixture.bestMatch ? [fixture.bestMatch] : [];

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const probeBlob = new Blob(["probe"], { type: "image/jpeg" });
    const result = await client.verifyCard({
      probeImage: probeBlob,
      probeFileName: "probe.jpg",
      referenceId: "mert.png",
      threshold: 0.72,
    });

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/verify/card");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("probeImage")).toBeInstanceOf(Blob);
    expect(body.get("userId")).toBeNull();
    expect(body.get("referenceId")).toBe("mert.png");
    expect(body.get("threshold")).toBe("0.72");
  });

  it("enrollCardReference posts multipart form data to /enroll/card/reference", async () => {
    const fixture: CardEnrollmentReferenceResponse = {
      ok: true,
      userId: "emre",
      reference: {
        imagePath: "/tmp/card-references/emre.jpg",
        enrolledAt: "2026-05-21T10:00:00.000Z",
        source: "upload",
      },
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.enrollCardReference({
      userId: "emre",
      referenceImage: new Blob(["reference"], { type: "image/jpeg" }),
      referenceFileName: "emre-card.jpg",
    });

    expect(result).toEqual(fixture);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/enroll/card/reference");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("emre");
    expect(body.get("referenceImage")).toBeInstanceOf(Blob);
  });

  it("verifyCard can target the current user card", async () => {
    const fixture: CardVerificationResult = {
      ok: true,
      matched: true,
      threshold: 0.7,
      checkedCount: 1,
      reason: null,
      bestMatch: null,
      candidates: [],
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.verifyCard({
      userId: "emre",
      probeImage: new Blob(["probe"], { type: "image/jpeg" }),
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get("userId")).toBe("emre");
  });

  it("verifyCard rejects when probeImage is missing", async () => {
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(client.verifyCard({} as { probeImage: Blob })).rejects.toThrow(
      "verifyCard requires probeImage"
    );
  });
});
