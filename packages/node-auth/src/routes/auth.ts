import express, { type Request, type Response } from "express";
import { FileUserStore } from "../auth/userStore";

type AuthRequest = {
  userId: string;
  password: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAuthRequest(body: unknown): {
  request: AuthRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = typeof body.userId === "string" ? body.userId.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!userId) fieldErrors.userId = "userId is required.";
  if (!password) fieldErrors.password = "password is required.";

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return { request: { userId, password }, fieldErrors };
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const error = details === undefined ? { code, message } : { code, message, details };
  res.status(status).json({ error });
}

export function createAuthRouter(args: {
  userStore?: FileUserStore;
  nowFnIso?: () => string;
} = {}) {
  const router = express.Router();
  const userStore = args.userStore ?? new FileUserStore();
  const nowFnIso = args.nowFnIso ?? (() => new Date().toISOString());

  router.get("/auth/users", async (_req: Request, res: Response) => {
    try {
      const users = await userStore.listUsers();
      res.status(200).json({
        ok: true,
        users: users.map((user) => ({
          userId: user.id,
          ...(typeof user.createdAt === "string" ? { createdAt: user.createdAt } : {}),
          ...(typeof user.updatedAt === "string" ? { updatedAt: user.updatedAt } : {}),
        })),
      });
    } catch (error) {
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to list users.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.post("/auth/register", async (req: Request, res: Response) => {
    const { request, fieldErrors } = parseAuthRequest(req.body);
    if (!request) {
      sendError(res, 400, "VALIDATION_ERROR", "Invalid registration request.", {
        fieldErrors,
      });
      return;
    }

    try {
      const existing = await userStore.findUser(request.userId);
      if (existing) {
        if (existing.password !== request.password) {
          sendError(res, 409, "USER_EXISTS", "User already exists with a different password.");
          return;
        }

        res.status(200).json({ ok: true, userId: existing.id, created: false });
        return;
      }

      const created = await userStore.createUser(request.userId, request.password, nowFnIso());
      res.status(201).json({ ok: true, userId: created.id, created: true });
    } catch (error) {
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to register user.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.post("/auth/login", async (req: Request, res: Response) => {
    const { request, fieldErrors } = parseAuthRequest(req.body);
    if (!request) {
      sendError(res, 400, "VALIDATION_ERROR", "Invalid login request.", {
        fieldErrors,
      });
      return;
    }

    try {
      const user = await userStore.findUser(request.userId);
      if (!user || user.password !== request.password) {
        sendError(res, 401, "INVALID_CREDENTIALS", "Invalid userId or password.");
        return;
      }

      res.status(200).json({ ok: true, userId: user.id });
    } catch (error) {
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to login.",
        error instanceof Error ? error.message : error
      );
    }
  });

  return router;
}
