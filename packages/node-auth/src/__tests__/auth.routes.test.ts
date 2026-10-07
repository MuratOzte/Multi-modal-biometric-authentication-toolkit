import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { FileUserStore } from "../auth/userStore";
import { createApp } from "../server";

async function createUsersFile(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-users-test-"));
  const filePath = path.join(tempDir, "users.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({
      users: [
        { id: "emre", password: "emre" },
        { id: "murat", password: "murat" },
        { id: "mert", password: "mert" },
      ],
    }),
    "utf8"
  );
  return filePath;
}

describe("auth routes", () => {
  it("logs in seeded local users", async () => {
    const usersFile = await createUsersFile();
    const app = createApp({
      userStore: new FileUserStore({ filePath: usersFile }),
      useInMemoryStorage: true,
    });

    const response = await request(app).post("/auth/login").send({
      userId: "emre",
      password: "emre",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, userId: "emre" });
  });

  it("rejects invalid passwords", async () => {
    const usersFile = await createUsersFile();
    const app = createApp({
      userStore: new FileUserStore({ filePath: usersFile }),
      useInMemoryStorage: true,
    });

    const response = await request(app).post("/auth/login").send({
      userId: "mert",
      password: "wrong",
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: "INVALID_CREDENTIALS" },
    });
  });

  it("lists local users without exposing passwords", async () => {
    const usersFile = await createUsersFile();
    const app = createApp({
      userStore: new FileUserStore({ filePath: usersFile }),
      useInMemoryStorage: true,
    });

    const response = await request(app).get("/auth/users");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      users: [
        { userId: "emre" },
        { userId: "murat" },
        { userId: "mert" },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("registers new users and treats same-password duplicate registration as ready", async () => {
    const usersFile = await createUsersFile();
    const app = createApp({
      userStore: new FileUserStore({ filePath: usersFile }),
      useInMemoryStorage: true,
    });

    const created = await request(app).post("/auth/register").send({
      userId: "ayse",
      password: "ayse",
    });

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ ok: true, userId: "ayse", created: true });

    const duplicate = await request(app).post("/auth/register").send({
      userId: "ayse",
      password: "ayse",
    });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ ok: true, userId: "ayse", created: false });
  });

  it("rejects duplicate registration with a different password", async () => {
    const usersFile = await createUsersFile();
    const app = createApp({
      userStore: new FileUserStore({ filePath: usersFile }),
      useInMemoryStorage: true,
    });

    const response = await request(app).post("/auth/register").send({
      userId: "murat",
      password: "new-password",
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: { code: "USER_EXISTS" },
    });
  });
});
