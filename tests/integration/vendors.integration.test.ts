import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, disconnectDatabase, prisma } from "../../src/config/database.js";
import { connectRedis, disconnectRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/app.js";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import { grantAdminByEmail } from "../../src/modules/admin/admin.service.js";

const users = {
  applicant: { email: `vendor-applicant-${randomUUID()}@example.com`, password: "phase-three-applicant-password" },
  admin: { email: `vendor-admin-${randomUUID()}@example.com`, password: "phase-three-admin-password" },
  other: { email: `vendor-other-${randomUUID()}@example.com`, password: "phase-three-other-password" },
};
const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `vendor-auth-${randomUUID()}`, limit: 50, windowSeconds: 60 }),
  vendorRateLimiters: {
    onboarding: createRateLimit({ prefix: `vendor-onboarding-${randomUUID()}`, limit: 20, windowSeconds: 60 }),
    adminMutation: createRateLimit({ prefix: `vendor-admin-${randomUUID()}`, limit: 50, windowSeconds: 60 }),
  },
});
const registeredEmails = Object.values(users).map(({ email }) => email);
let databaseConnected = false;
let redisConnected = false;

interface BrowserSession {
  cookies: string;
  csrf: string;
}

function cookieHeader(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function cookieValue(header: string, name: string): string {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) throw new Error(`Expected ${name} cookie`);
  return match[1] ?? "";
}

async function createAccount(account: { email: string; password: string }): Promise<BrowserSession> {
  const csrfResponse = await request(app).get("/api/v1/auth/csrf").expect(200);
  const initialCsrf = csrfResponse.body.data.csrfToken as string;
  await request(app)
    .post("/api/v1/auth/register")
    .set("Cookie", `csrf_token=${initialCsrf}`)
    .set("X-CSRF-Token", initialCsrf)
    .send(account)
    .expect(202);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .set("Cookie", `csrf_token=${initialCsrf}`)
    .set("X-CSRF-Token", initialCsrf)
    .send(account)
    .expect(200);
  const cookies = cookieHeader(login.headers["set-cookie"] as string[] | undefined);
  return { cookies, csrf: cookieValue(cookies, "csrf_token") };
}

function postWithCsrf(path: string, session: BrowserSession) {
  return request(app)
    .post(path)
    .set("Cookie", session.cookies)
    .set("X-CSRF-Token", session.csrf);
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) {
    const userIds = await prisma.user.findMany({ where: { email: { in: registeredEmails } }, select: { id: true } });
    await prisma.store.deleteMany({ where: { ownerId: { in: userIds.map(({ id }) => id) } } });
    await prisma.user.deleteMany({ where: { email: { in: registeredEmails } } });
  }
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Phase 3 vendor applications and stores", () => {
  it("enforces onboarding, review, store ownership, activation, and public visibility", async () => {
    const customer = await createAccount(users.applicant);
    const admin = await createAccount(users.admin);
    expect(await grantAdminByEmail(users.admin.email)).toBe("granted");
    expect(await grantAdminByEmail(users.admin.email)).toBe("already_admin");
    const other = await createAccount(users.other);

    const applicationInput = {
      businessName: "Coastal Goods",
      storeName: "Coastal Goods Shop",
      businessDescription: "Small home and lifestyle goods shop.",
      contactPhone: "+2348012345678",
    };
    const submissions = await Promise.all([
      postWithCsrf("/api/v1/vendor-applications", customer).send(applicationInput),
      postWithCsrf("/api/v1/vendor-applications", customer).send(applicationInput),
    ]);
    expect(submissions.map(({ status }) => status).sort()).toEqual([201, 409]);
    const created = submissions.find(({ status }) => status === 201);
    expect(created?.body.data.application.status).toBe("pending");
    const applicationId = created?.body.data.application.id as string;

    const ownApplications = await request(app)
      .get("/api/v1/vendor-applications/me")
      .set("Cookie", customer.cookies)
      .expect(200);
    expect(ownApplications.body.data.applications).toHaveLength(1);

    const adminList = await request(app)
      .get("/api/v1/admin/vendor-applications?page=1&limit=10&status=pending")
      .set("Cookie", admin.cookies)
      .expect(200);
    expect(adminList.body.data.applications[0].id).toBe(applicationId);
    expect(adminList.body.meta).toMatchObject({ page: 1, limit: 10, total: 1 });

    await postWithCsrf(`/api/v1/admin/vendor-applications/${applicationId}/reject`, admin)
      .send({ reason: "Please provide clearer business activity details." })
      .expect(200);
    const rejectedHistory = await request(app)
      .get("/api/v1/vendor-applications/me")
      .set("Cookie", customer.cookies)
      .expect(200);
    expect(rejectedHistory.body.data.applications[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "Please provide clearer business activity details.",
    });

    const resubmission = await postWithCsrf("/api/v1/vendor-applications", customer)
      .send({ ...applicationInput, storeName: "Coastal Goods Outlet" })
      .expect(201);
    const resubmittedId = resubmission.body.data.application.id as string;
    const approval = await postWithCsrf(`/api/v1/admin/vendor-applications/${resubmittedId}/approve`, admin)
      .send({})
      .expect(200);
    const storeId = approval.body.data.store.id as string;
    const slug = approval.body.data.store.slug as string;
    expect(approval.body.data.store.status).toBe("pending");

    await request(app).get(`/api/v1/stores/${slug}`).expect(404);
    await request(app).get("/api/v1/stores/me").set("Cookie", customer.cookies).expect(200);
    await request(app).get("/api/v1/stores/me").set("Cookie", other.cookies).expect(403);
    await postWithCsrf(`/api/v1/admin/vendor-applications/${resubmittedId}/approve`, admin)
      .send({})
      .expect(409);

    const changedSlug = `coastal-outlet-${randomUUID().slice(0, 8)}`;
    await request(app)
      .patch("/api/v1/stores/me")
      .set("Cookie", customer.cookies)
      .set("X-CSRF-Token", customer.csrf)
      .send({ slug: changedSlug })
      .expect(200);
    await postWithCsrf(`/api/v1/admin/stores/${storeId}/activate`, admin).send({}).expect(200);
    const publicStore = await request(app).get(`/api/v1/stores/${changedSlug}`).expect(200);
    expect(publicStore.body.data.store.slug).toBe(changedSlug);
    expect(publicStore.body.data.store.contactPhone).toBeUndefined();

    await request(app)
      .patch("/api/v1/stores/me")
      .set("Cookie", customer.cookies)
      .set("X-CSRF-Token", customer.csrf)
      .send({ slug: `another-${randomUUID().slice(0, 8)}` })
      .expect(409);
  });
});
