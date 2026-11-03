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
  vendorA: { email: `cart-vendor-a-${suffix}@example.com`, password: "phase-six-vendor-password" },
  vendorB: { email: `cart-vendor-b-${suffix}@example.com`, password: "phase-six-vendor-password" },
  customer: { email: `cart-customer-${suffix}@example.com`, password: "phase-six-customer-password" },
  otherCustomer: { email: `cart-other-${suffix}@example.com`, password: "phase-six-customer-password" },
  admin: { email: `cart-admin-${suffix}@example.com`, password: "phase-six-admin-password" },
};
const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `cart-auth-${suffix}`, limit: 50, windowSeconds: 60 }),
  vendorRateLimiters: {
    onboarding: createRateLimit({ prefix: `cart-onboarding-${suffix}`, limit: 30, windowSeconds: 60 }),
    adminMutation: createRateLimit({ prefix: `cart-admin-${suffix}`, limit: 50, windowSeconds: 60 }),
  },
});
let databaseConnected = false;
let redisConnected = false;
const storeIds: string[] = [];
const productIds: string[] = [];
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
  await request(app).post("/api/v1/auth/register").set("Cookie", `csrf_token=${csrf}`)
    .set("X-CSRF-Token", csrf).send(account).expect(202);
  const login = await request(app).post("/api/v1/auth/login").set("Cookie", `csrf_token=${csrf}`)
    .set("X-CSRF-Token", csrf).send(account).expect(200);
  const cookie = cookiesFrom(login.headers["set-cookie"] as string[] | undefined);
  return { cookies: cookie, csrf: readCookie(cookie, "csrf_token") };
}

function withCsrf(method: "post" | "put" | "patch" | "delete", path: string, session: BrowserSession) {
  return request(app)[method](path).set("Cookie", session.cookies).set("X-CSRF-Token", session.csrf);
}

async function createStore(vendor: BrowserSession, admin: BrowserSession, name: string) {
  const application = await withCsrf("post", "/api/v1/vendor-applications", vendor)
    .send({ businessName: name, storeName: `${name} Store`, contactPhone: "+2348012345678" }).expect(201);
  const applicationId = application.body.data.application.id as string;
  await withCsrf("post", `/api/v1/admin/vendor-applications/${applicationId}/approve`, admin).send({}).expect(200);
  const store = await request(app).get("/api/v1/stores/me").set("Cookie", vendor.cookies).expect(200);
  const storeId = store.body.data.store.id as string;
  storeIds.push(storeId);
  await withCsrf("post", `/api/v1/admin/stores/${storeId}/activate`, admin).send({}).expect(200);
  return storeId;
}

async function createProduct(vendor: BrowserSession, name: string, sku: string, priceAmount: number) {
  const product = await withCsrf("post", "/api/v1/vendor/products", vendor)
    .send({ name, description: "Cart integration fixture.", categoryIds: [categoryId] }).expect(201);
  const productId = product.body.data.product.id as string;
  productIds.push(productId);
  const variant = await withCsrf("post", `/api/v1/vendor/products/${productId}/variants`, vendor)
    .send({ sku, options: { color: "Black" }, priceAmount }).expect(201);
  const variantId = variant.body.data.variant.id as string;
  await withCsrf("patch", `/api/v1/vendor/inventory/${variantId}`, vendor)
    .send({ quantityOnHand: 10 }).expect(200);
  await withCsrf("post", `/api/v1/vendor/products/${productId}/publish`, vendor).send({}).expect(200);
  return { productId, variantId };
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(accounts).map(({ email }) => email) } } });
  }
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Phase 6 cart", () => {
  it("keeps a private multi-vendor cart with current prices and live availability", async () => {
    const vendorA = await accountSession(accounts.vendorA);
    const vendorB = await accountSession(accounts.vendorB);
    const customer = await accountSession(accounts.customer);
    const otherCustomer = await accountSession(accounts.otherCustomer);
    const admin = await accountSession(accounts.admin);
    expect(await grantAdminByEmail(accounts.admin.email)).toBe("granted");

    await createStore(vendorA, admin, "Cart Goods A");
    await createStore(vendorB, admin, "Cart Goods B");
    const categorySlug = `cart-${suffix.slice(0, 8)}`;
    const category = await withCsrf("post", "/api/v1/admin/categories", admin)
      .send({ name: "Cart Category", slug: categorySlug }).expect(201);
    categoryId = category.body.data.category.id as string;
    const itemA = await createProduct(vendorA, "Cart Product A", `CARTA-${suffix.slice(0, 8)}`, 100);
    const itemB = await createProduct(vendorB, "Cart Product B", `CARTB-${suffix.slice(0, 8)}`, 250);

    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemA.variantId, quantity: 2 }).expect(200);
    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemB.variantId, quantity: 3 }).expect(200);
    const initial = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
    expect(initial.body.data.cart.items).toHaveLength(2);
    expect(initial.body.data.cart.total).toEqual({ amount: 950, currency: "NGN" });
    expect(initial.body.data.cart.storeSubtotals).toHaveLength(2);

    await withCsrf("patch", `/api/v1/vendor/products/${itemA.productId}/variants/${itemA.variantId}`, vendorA)
      .send({ priceAmount: 150 }).expect(200);
    const changedPrice = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
    const changedItem = changedPrice.body.data.cart.items.find((item: { variant: { id: string } }) => item.variant.id === itemA.variantId);
    expect(changedItem.priceChanged).toBe(true);
    expect(changedItem.quotedPrice.amount).toBe(100);
    expect(changedPrice.body.data.cart.total.amount).toBe(1050);

    const otherCart = await request(app).get("/api/v1/cart").set("Cookie", otherCustomer.cookies).expect(200);
    expect(otherCart.body.data.cart.items).toHaveLength(0);
    await withCsrf("patch", `/api/v1/cart/items/${changedItem.id}`, otherCustomer).send({ quantity: 1 }).expect(404);

    const reservation = await withCsrf("post", "/api/v1/inventory/reservations", otherCustomer)
      .send({ variantId: itemA.variantId, quantity: 10 }).expect(201);
    const unavailable = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
    const unavailableItem = unavailable.body.data.cart.items.find((item: { variant: { id: string } }) => item.variant.id === itemA.variantId);
    expect(unavailableItem.isAvailable).toBe(false);
    await withCsrf("put", "/api/v1/cart/items", customer)
      .send({ variantId: itemA.variantId, quantity: 1 }).expect(409);
    await withCsrf("delete", `/api/v1/inventory/reservations/${reservation.body.data.reservation.id}`, otherCustomer).expect(200);

    await withCsrf("delete", `/api/v1/cart/items/${changedItem.id}`, customer).expect(200);
    const cleared = await withCsrf("delete", "/api/v1/cart", customer).expect(200);
    expect(cleared.body.data.cart.items).toHaveLength(0);
  });
});
