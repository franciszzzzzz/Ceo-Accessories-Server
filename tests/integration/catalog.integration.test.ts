import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase, disconnectDatabase, prisma } from "../../src/config/database.js";
import { connectRedis, disconnectRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/app.js";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import { grantAdminByEmail } from "../../src/modules/admin/admin.service.js";

const accounts = {
  vendor: { email: `catalog-vendor-${randomUUID()}@example.com`, password: "phase-four-vendor-password" },
  admin: { email: `catalog-admin-${randomUUID()}@example.com`, password: "phase-four-admin-password" },
};
const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `catalog-auth-${randomUUID()}`, limit: 40, windowSeconds: 60 }),
  vendorRateLimiters: {
    onboarding: createRateLimit({ prefix: `catalog-onboarding-${randomUUID()}`, limit: 20, windowSeconds: 60 }),
    adminMutation: createRateLimit({ prefix: `catalog-vendor-admin-${randomUUID()}`, limit: 40, windowSeconds: 60 }),
  },
});
let databaseConnected = false;
let redisConnected = false;
const testCategorySlugs: string[] = [];

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

function postWithCsrf(path: string, session: BrowserSession) {
  return request(app).post(path).set("Cookie", session.cookies).set("X-CSRF-Token", session.csrf);
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) {
    const stores = await prisma.store.findMany({ where: { owner: { email: accounts.vendor.email } }, select: { id: true } });
    const storeIds = stores.map(({ id }) => id);
    await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    const categoryIds = (await prisma.category.findMany({
      where: { slug: { in: testCategorySlugs } },
      select: { id: true },
    })).map(({ id }) => id);
    await prisma.category.updateMany({ where: { id: { in: categoryIds } }, data: { parentId: null } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.user.deleteMany({ where: { email: { in: [accounts.vendor.email, accounts.admin.email] } } });
  }
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Phase 4 catalog", () => {
  it("manages categories and vendor products while publishing only valid active listings", async () => {
    const vendor = await accountSession(accounts.vendor);
    const admin = await accountSession(accounts.admin);
    expect(await grantAdminByEmail(accounts.admin.email)).toBe("granted");
    const adminWithRole = { cookies: admin.cookies, csrf: admin.csrf };

    const application = await postWithCsrf("/api/v1/vendor-applications", vendor)
      .send({ businessName: "Catalog Goods", storeName: "Catalog Goods Store", contactPhone: "+2348012345678" })
      .expect(201);
    await postWithCsrf(`/api/v1/admin/vendor-applications/${application.body.data.application.id}/approve`, adminWithRole)
      .send({})
      .expect(200);
    const vendorStore = await request(app).get("/api/v1/stores/me").set("Cookie", vendor.cookies).expect(200);
    const storeId = vendorStore.body.data.store.id as string;
    const storeSlug = vendorStore.body.data.store.slug as string;
    await postWithCsrf(`/api/v1/admin/stores/${storeId}/activate`, adminWithRole).send({}).expect(200);

    const rootSlug = `catalog-test-root-${randomUUID().slice(0, 8)}`;
    testCategorySlugs.push(rootSlug);
    const root = await postWithCsrf("/api/v1/admin/categories", adminWithRole)
      .send({ name: "Home Goods", slug: rootSlug })
      .expect(201);
    const rootId = root.body.data.category.id as string;
    const childSlug = `catalog-test-child-${randomUUID().slice(0, 8)}`;
    testCategorySlugs.push(childSlug);
    const child = await postWithCsrf("/api/v1/admin/categories", adminWithRole)
      .send({ name: "Kitchen", slug: childSlug, parentId: rootId })
      .expect(201);
    const childId = child.body.data.category.id as string;
    await request(app).patch(`/api/v1/admin/categories/${rootId}`)
      .set("Cookie", adminWithRole.cookies)
      .set("X-CSRF-Token", adminWithRole.csrf)
      .send({ parentId: childId })
      .expect(422);

    const product = await postWithCsrf("/api/v1/vendor/products", vendor)
      .send({ name: "Linen Shirt", description: "Lightweight cotton shirt.", categoryIds: [childId] })
      .expect(201);
    const productId = product.body.data.product.id as string;
    const productSlug = product.body.data.product.slug as string;
    await postWithCsrf(`/api/v1/vendor/products/${productId}/publish`, vendor).send({}).expect(422);

    const variant = await postWithCsrf(`/api/v1/vendor/products/${productId}/variants`, vendor)
      .send({ sku: "linen-shirt-blue-m", options: { color: "Blue", size: "M" }, priceAmount: 175_000 })
      .expect(201);
    expect(variant.body.data.variant.price).toEqual({ amount: 175_000, currency: "NGN" });

    const duplicateProduct = await postWithCsrf("/api/v1/vendor/products", vendor)
      .send({ name: "Linen Shirt Duplicate", description: "Draft product.", categoryIds: [childId] })
      .expect(201);
    await postWithCsrf(`/api/v1/vendor/products/${duplicateProduct.body.data.product.id}/variants`, vendor)
      .send({ sku: "LINEN-SHIRT-BLUE-M", options: { color: "Blue", size: "L" }, priceAmount: 175_000 })
      .expect(409);

    await postWithCsrf(`/api/v1/vendor/products/${productId}/publish`, vendor).send({}).expect(200);
    const search = await request(app).get(`/api/v1/products?q=linen&category=${child.body.data.category.slug}`).expect(200);
    expect(search.body.data.products).toHaveLength(1);
    expect(search.body.data.products[0].variants[0].price.amount).toBe(175_000);
    const detail = await request(app).get(`/api/v1/stores/${storeSlug}/products/${productSlug}`).expect(200);
    expect(detail.body.data.product.store.slug).toBe(storeSlug);

    await postWithCsrf(`/api/v1/vendor/products/${productId}/variants/${variant.body.data.variant.id}/archive`, vendor)
      .send({})
      .expect(409);
    await postWithCsrf(`/api/v1/vendor/products/${productId}/archive`, vendor).send({}).expect(200);
    await request(app).get(`/api/v1/stores/${storeSlug}/products/${productSlug}`).expect(404);

    const publicCategories = await request(app).get("/api/v1/categories").expect(200);
    expect(publicCategories.body.data.categories.some((category: { id: string }) => category.id === rootId)).toBe(true);
    await postWithCsrf(`/api/v1/admin/categories/${rootId}/archive`, adminWithRole).send({}).expect(200);
    await request(app).get("/api/v1/categories").expect(200);
  });
});
