import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, disconnectDatabase, prisma } from "../../src/config/database.js";
import { connectRedis, disconnectRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/app.js";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import { grantAdminByEmail } from "../../src/modules/admin/admin.service.js";

const suffix = randomUUID();
const accounts = {
  vendor: { email: `inventory-vendor-${suffix}@example.com`, password: "phase-five-vendor-password" },
  customer: { email: `inventory-customer-${suffix}@example.com`, password: "phase-five-customer-password" },
  otherCustomer: { email: `inventory-other-${suffix}@example.com`, password: "phase-five-customer-password" },
  admin: { email: `inventory-admin-${suffix}@example.com`, password: "phase-five-admin-password" },
};
const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `inventory-auth-${suffix}`, limit: 40, windowSeconds: 60 }),
  vendorRateLimiters: {
    onboarding: createRateLimit({ prefix: `inventory-onboarding-${suffix}`, limit: 20, windowSeconds: 60 }),
    adminMutation: createRateLimit({ prefix: `inventory-admin-${suffix}`, limit: 40, windowSeconds: 60 }),
  },
});
let databaseConnected = false;
let redisConnected = false;
let storeId: string | undefined;
let productId: string | undefined;
let categoryId: string | undefined;

interface BrowserSession {
  cookies: string;
  csrf: string;
}

function cookiesFrom(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function readCookie(header: string, name: string): string {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) throw new Error(`Expected ${name} cookie`);
  return match[1] ?? "";
}

async function accountSession(account: { email: string; password: string }): Promise<BrowserSession> {
  const csrfResponse = await request(app).get("/api/v1/auth/csrf").expect(200);
  const csrf = csrfResponse.body.data.csrfToken as string;
  await request(app).post("/api/v1/auth/register")
    .set("Cookie", `csrf_token=${csrf}`)
    .set("X-CSRF-Token", csrf)
    .send(account)
    .expect(202);
  const login = await request(app).post("/api/v1/auth/login")
    .set("Cookie", `csrf_token=${csrf}`)
    .set("X-CSRF-Token", csrf)
    .send(account)
    .expect(200);
  const cookie = cookiesFrom(login.headers["set-cookie"] as string[] | undefined);
  return { cookies: cookie, csrf: readCookie(cookie, "csrf_token") };
}

function withCsrf(method: "post" | "patch" | "delete", path: string, session: BrowserSession) {
  return request(app)[method](path).set("Cookie", session.cookies).set("X-CSRF-Token", session.csrf);
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) {
    if (storeId) await prisma.product.deleteMany({ where: { storeId } });
    if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(accounts).map(({ email }) => email) } } });
  }
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Phase 5 inventory", () => {
  it("manages stock, enforces concurrent reservations, release ownership and low-stock reporting", async () => {
    const vendor = await accountSession(accounts.vendor);
    const customer = await accountSession(accounts.customer);
    const otherCustomer = await accountSession(accounts.otherCustomer);
    const admin = await accountSession(accounts.admin);
    expect(await grantAdminByEmail(accounts.admin.email)).toBe("granted");

    const application = await withCsrf("post", "/api/v1/vendor-applications", vendor)
      .send({ businessName: "Inventory Goods", storeName: "Inventory Store", contactPhone: "+2348012345678" })
      .expect(201);
    await withCsrf("post", `/api/v1/admin/vendor-applications/${application.body.data.application.id}/approve`, admin)
      .send({})
      .expect(200);
    const store = await request(app).get("/api/v1/stores/me").set("Cookie", vendor.cookies).expect(200);
    storeId = store.body.data.store.id as string;
    await withCsrf("post", `/api/v1/admin/stores/${storeId}/activate`, admin).send({}).expect(200);

    const categorySlug = `inventory-${suffix.slice(0, 8)}`;
    const category = await withCsrf("post", "/api/v1/admin/categories", admin)
      .send({ name: "Inventory Category", slug: categorySlug })
      .expect(201);
    categoryId = category.body.data.category.id as string;
    const product = await withCsrf("post", "/api/v1/vendor/products", vendor)
      .send({ name: "Stocked Product", description: "Inventory integration fixture.", categoryIds: [categoryId] })
      .expect(201);
    productId = product.body.data.product.id as string;
    const variant = await withCsrf("post", `/api/v1/vendor/products/${productId}/variants`, vendor)
      .send({ sku: `INVENTORY-${suffix.slice(0, 8)}`, options: { color: "Blue" }, priceAmount: 1200 })
      .expect(201);
    const variantId = variant.body.data.variant.id as string;
    await withCsrf("post", `/api/v1/vendor/products/${productId}/publish`, vendor).send({}).expect(200);

    const initial = await request(app).get("/api/v1/vendor/inventory").set("Cookie", vendor.cookies);
    expect(initial.status, JSON.stringify(initial.body)).toBe(200);
    expect(initial.body.data.inventory[0]).toMatchObject({ quantityOnHand: 0, availableQuantity: 0, lowStockThreshold: 5 });
    await withCsrf("patch", `/api/v1/vendor/inventory/${variantId}`, vendor)
      .send({ quantityOnHand: 10, lowStockThreshold: 3 })
      .expect(200);

    const first = await withCsrf("post", "/api/v1/inventory/reservations", customer)
      .send({ variantId, quantity: 4 })
      .expect(201);
    expect(first.body.data.availableQuantity).toBe(6);
    await withCsrf("post", "/api/v1/inventory/reservations", otherCustomer)
      .send({ variantId, quantity: 7 })
      .expect(409);

    const competing = await Promise.all([
      withCsrf("post", "/api/v1/inventory/reservations", customer).send({ variantId, quantity: 4 }),
      withCsrf("post", "/api/v1/inventory/reservations", otherCustomer).send({ variantId, quantity: 4 }),
    ]);
    expect(competing.map(({ status }) => status).sort()).toEqual([201, 409]);

    const inventory = await request(app).get("/api/v1/vendor/inventory?lowStockOnly=true").set("Cookie", vendor.cookies).expect(200);
    expect(inventory.body.data.inventory[0].availableQuantity).toBe(2);
    await withCsrf("patch", `/api/v1/vendor/inventory/${variantId}`, vendor)
      .send({ quantityOnHand: 7 })
      .expect(409);
    await request(app).get("/api/v1/admin/inventory/low-stock").set("Cookie", admin.cookies).expect(200);

    const reservationId = first.body.data.reservation.id as string;
    await withCsrf("delete", `/api/v1/inventory/reservations/${reservationId}`, otherCustomer).expect(404);
    await withCsrf("delete", `/api/v1/inventory/reservations/${reservationId}`, customer).expect(200);
    const ownReservations = await request(app).get("/api/v1/inventory/reservations/me").set("Cookie", customer.cookies).expect(200);
    expect(ownReservations.body.data.reservations.some((entry: { id: string }) => entry.id === reservationId)).toBe(false);
  });
});
