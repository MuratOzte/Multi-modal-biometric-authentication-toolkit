import type {
  FaceVerificationFailureCode,
  FaceVerificationResult,
  UserProfiles,
} from "@securekit/core";
import { FacePythonBridgeError } from "./pythonBridge";
import {
  FaceServiceError,
  type FaceVerificationServiceResult,
} from "./types";

function mapPythonReasonToFailureCode(
  reason: string | null
): FaceVerificationFailureCode | undefined {
  if (!reason) return undefined;

  if (reason === "reference_face_not_detected" || reason === "probe_face_not_detected") {
    return "FACE_NOT_DETECTED";
  }
  if (reason === "file_not_found") {
    return "REFERENCE_NOT_FOUND";
  }
  if (reason === "invalid_threshold") {
    return "INVALID_REQUEST";
  }
  if (reason === "gpu_required") {
    return "GPU_REQUIRED";
  }
  if (reason === "internal_error") {
    return "PYTHON_PROCESS_ERROR";
  }

  return undefined;
}

export function buildNextProfiles(args: {
  userId: string;
  existingProfiles: UserProfiles | null;
  nowIso: string;
  updates: {
    faceReferenceImagePath: string;
    faceReferenceEnrolledAt: string;
  };
}): UserProfiles {
  const existing = args.existingProfiles;

  return {
    userId: args.userId,
    keystroke: existing?.keystroke ?? null,
    faceReferenceImagePath: args.updates.faceReferenceImagePath,
    faceReferenceEnrolledAt: args.updates.faceReferenceEnrolledAt,
    faceEmbedding: existing?.faceEmbedding ?? null,
    cardReferenceImagePath: existing?.cardReferenceImagePath ?? null,
    cardReferenceEnrolledAt: existing?.cardReferenceEnrolledAt ?? null,
    voice: existing?.voice ?? null,
    voiceEmbedding: existing?.voiceEmbedding ?? null,
    updatedAt: args.nowIso,
  };
}

export function normalizePythonResult(
  result: FaceVerificationResult,
  referenceImagePath: string
): FaceVerificationServiceResult {
  const normalized: FaceVerificationServiceResult = {
    ok: result.ok,
    matched: result.matched,
    score: typeof result.score === "number" && Number.isFinite(result.score) ? result.score : null,
    reason: typeof result.reason === "string" ? result.reason : null,
    referenceImagePath,
  };
  if (result.runtime) {
    normalized.runtime = result.runtime;
  }

  if (result.failureCode) {
    normalized.failureCode = result.failureCode;
  } else if (!normalized.ok) {
    normalized.failureCode =
      mapPythonReasonToFailureCode(normalized.reason) ?? "PYTHON_PROCESS_ERROR";
  }

  return normalized;
}

export function mapPythonBridgeError(error: FacePythonBridgeError): FaceServiceError {
  if (error.code === "PYTHON_SPAWN_FAILED") {
    return new FaceServiceError(
      "PYTHON_RUNTIME_UNAVAILABLE",
      "Python runtime is not available for face verification.",
      503
    );
  }

  if (error.code === "PYTHON_TIMEOUT") {
    return new FaceServiceError("PYTHON_TIMEOUT", "Face verification process timed out.", 504);
  }

  if (error.code === "GPU_REQUIRED") {
    return new FaceServiceError(
      "GPU_REQUIRED",
      "GPU is required for face verification but CUDA is unavailable.",
      503,
      error.details
    );
  }

  if (error.code === "PYTHON_JSON_PARSE_ERROR" || error.code === "PYTHON_OUTPUT_INVALID") {
    return new FaceServiceError(
      "PYTHON_OUTPUT_INVALID",
      "Invalid response received from face verification process.",
      502
    );
  }

  return new FaceServiceError("PYTHON_PROCESS_ERROR", "Face verification process failed.", 502);
}
