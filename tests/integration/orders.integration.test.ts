import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectDatabase, disconnectDatabase, prisma } from "../../src/config/database.js";
import { connectRedis, disconnectRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/app.js";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import { grantAdminByEmail } from "../../src/modules/admin/admin.service.js";

const paystackMocks = vi.hoisted(() => ({
  assertPaystackConfigured: vi.fn(),
  initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({ authorizationUrl: `https://checkout.paystack.com/${reference}`, transactionId: "test-access-code" })),
  verifyTransaction: vi.fn(async (reference: string) => ({ reference, status: "success", amount: 400, currency: "NGN", transactionId: "test-transaction-400" })),
  verifyWebhookSignature: vi.fn(() => true),
  createRefund: vi.fn(async () => ({ providerRefundId: `refund-${suffix.slice(0, 8)}`, status: "pending" })),
}));

vi.mock("../../src/modules/payments/paystack.provider.js", () => paystackMocks);

const suffix = randomUUID();
const accounts = {
  vendorA: { email: `order-vendor-a-${suffix}@example.com`, password: "phase-seven-vendor-password" },
  vendorB: { email: `order-vendor-b-${suffix}@example.com`, password: "phase-seven-vendor-password" },
  customer: { email: `order-customer-${suffix}@example.com`, password: "phase-seven-customer-password" },
  otherCustomer: { email: `order-other-${suffix}@example.com`, password: "phase-seven-customer-password" },
  admin: { email: `order-admin-${suffix}@example.com`, password: "phase-seven-admin-password" },
};
const app = createApp({
  globalRateLimiter: (_request, _response, next) => next(),
  authRateLimiter: createRateLimit({ prefix: `order-auth-${suffix}`, limit: 60, windowSeconds: 60 }),
  vendorRateLimiters: {
    onboarding: createRateLimit({ prefix: `order-onboarding-${suffix}`, limit: 40, windowSeconds: 60 }),
    adminMutation: createRateLimit({ prefix: `order-admin-${suffix}`, limit: 60, windowSeconds: 60 }),
  },
  orderRateLimiter: (_request, _response, next) => next(),
  paymentRateLimiter: (_request, _response, next) => next(),
  commissionRateLimiter: (_request, _response, next) => next(),
});
let databaseConnected = false;
let redisConnected = false;
const storeIds: string[] = [];
const productIds: string[] = [];
const idempotencyKeys: string[] = [];
const webhookEventKeys: string[] = [];
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
  const id = application.body.data.application.id as string;
  await withCsrf("post", `/api/v1/admin/vendor-applications/${id}/approve`, admin).send({}).expect(200);
  const store = await request(app).get("/api/v1/stores/me").set("Cookie", vendor.cookies).expect(200);
  const storeId = store.body.data.store.id as string;
  storeIds.push(storeId);
  await withCsrf("post", `/api/v1/admin/stores/${storeId}/activate`, admin).send({}).expect(200);
}

async function createProduct(vendor: BrowserSession, name: string, sku: string, priceAmount: number) {
  const product = await withCsrf("post", "/api/v1/vendor/products", vendor)
    .send({ name, description: "Order integration fixture.", categoryIds: [categoryId] }).expect(201);
  const productId = product.body.data.product.id as string;
  productIds.push(productId);
  const variant = await withCsrf("post", `/api/v1/vendor/products/${productId}/variants`, vendor)
    .send({ sku, options: { color: "Green" }, priceAmount }).expect(201);
  const variantId = variant.body.data.variant.id as string;
  await withCsrf("patch", `/api/v1/vendor/inventory/${variantId}`, vendor).send({ quantityOnHand: 10 }).expect(200);
  await withCsrf("post", `/api/v1/vendor/products/${productId}/publish`, vendor).send({}).expect(200);
  return { productId, variantId };
}

async function checkoutBody(customer: BrowserSession) {
  const cart = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
  return {
    shippingAddress: {
      recipientName: "Ada Buyer",
      phone: "+2348012345678",
      addressLine1: "12 Market Street",
      city: "Lagos",
      state: "Lagos",
    },
    items: cart.body.data.cart.items.map((item: { variant: { id: string }; quantity: number; quotedPrice: { amount: number } }) => ({
      variantId: item.variant.id,
      quantity: item.quantity,
      quotedPriceAmount: item.quotedPrice.amount,
    })),
  };
}

beforeAll(async () => {
  await connectDatabase();
  databaseConnected = true;
  await connectRedis();
  redisConnected = true;
});

afterAll(async () => {
  if (databaseConnected) {
    if (webhookEventKeys.length) await prisma.paymentWebhookEvent.deleteMany({ where: { eventKey: { in: webhookEventKeys } } });
    const orders = await prisma.order.findMany({
      where: { idempotencyKey: { in: idempotencyKeys } },
      select: { id: true, payment: { select: { id: true } } },
    });
    const paymentIds = orders.flatMap(({ payment }) => payment ? [payment.id] : []);
    if (storeIds.length) {
      await prisma.ledgerEntry.deleteMany({ where: { storeId: { in: storeIds } } });
      await prisma.payout.deleteMany({ where: { storeId: { in: storeIds } } });
      await prisma.commissionRule.deleteMany({ where: { OR: [{ storeId: { in: storeIds } }, { createdBy: { is: { email: accounts.admin.email } } }] } });
    }
    if (paymentIds.length) await prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    if (idempotencyKeys.length) await prisma.order.deleteMany({ where: { idempotencyKey: { in: idempotencyKeys } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(accounts).map(({ email }) => email) } } });
  }
  if (redisConnected) await disconnectRedis();
  if (databaseConnected) await disconnectDatabase();
});

describe("Checkout, payments, commissions, and payouts", () => {
  it("creates an idempotent multi-store order, allocates stock, scopes vendor views, and restores stock once on cancellation", async () => {
    const vendorA = await accountSession(accounts.vendorA);
    const vendorB = await accountSession(accounts.vendorB);
    const customer = await accountSession(accounts.customer);
    const otherCustomer = await accountSession(accounts.otherCustomer);
    const admin = await accountSession(accounts.admin);
    expect(await grantAdminByEmail(accounts.admin.email)).toBe("granted");
    await createStore(vendorA, admin, "Order Goods A");
    await createStore(vendorB, admin, "Order Goods B");
    const category = await withCsrf("post", "/api/v1/admin/categories", admin)
      .send({ name: "Order Category", slug: `orders-${suffix.slice(0, 8)}` }).expect(201);
    categoryId = category.body.data.category.id as string;
    await withCsrf("post", "/api/v1/admin/commission-rules", admin)
      .send({ rateBasisPoints: 1000 }).expect(201);
    await withCsrf("post", "/api/v1/admin/commission-rules", admin)
      .send({ categoryId, rateBasisPoints: 500 }).expect(201);
    await withCsrf("post", "/api/v1/admin/commission-rules", admin)
      .send({ categoryId, rateBasisPoints: 250 }).expect(409);
    const itemA = await createProduct(vendorA, "Order Product A", `ORDERA-${suffix.slice(0, 8)}`, 100);
    const itemB = await createProduct(vendorB, "Order Product B", `ORDERB-${suffix.slice(0, 8)}`, 250);

    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemA.variantId, quantity: 3 }).expect(200);
    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemB.variantId, quantity: 2 }).expect(200);
    await withCsrf("post", "/api/v1/inventory/reservations", customer)
      .send({ variantId: itemA.variantId, quantity: 1 }).expect(201);
    await withCsrf("post", "/api/v1/inventory/reservations", otherCustomer)
      .send({ variantId: itemA.variantId, quantity: 2 }).expect(201);

    const originalCheckout = await checkoutBody(customer);
    await withCsrf("post", "/api/v1/orders/checkout", customer).send(originalCheckout).expect(400);
    await withCsrf("patch", `/api/v1/vendor/products/${itemA.productId}/variants/${itemA.variantId}`, vendorA)
      .send({ priceAmount: 150 }).expect(200);
    const idempotencyKey = `phase7-${suffix}`;
    idempotencyKeys.push(idempotencyKey);
    await withCsrf("post", "/api/v1/orders/checkout", customer)
      .set("Idempotency-Key", idempotencyKey).send(originalCheckout).expect(409);
    const remainingCart = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
    expect(remainingCart.body.data.cart.items).toHaveLength(2);

    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemA.variantId, quantity: 3 }).expect(200);
    const checkout = await checkoutBody(customer);
    const duplicateRequests = await Promise.all([
      withCsrf("post", "/api/v1/orders/checkout", customer).set("Idempotency-Key", idempotencyKey).send(checkout),
      withCsrf("post", "/api/v1/orders/checkout", customer).set("Idempotency-Key", idempotencyKey).send(checkout),
    ]);
    expect(duplicateRequests.map(({ status }) => status)).toEqual([201, 201]);
    const orderId = duplicateRequests[0]?.body.data.order.id as string;
    expect(duplicateRequests[1]?.body.data.order.id).toBe(orderId);
    expect(duplicateRequests[0]?.body.data.order.total).toEqual({ amount: 950, currency: "NGN" });
    expect(duplicateRequests[0]?.body.data.order.subOrders).toHaveLength(2);
    expect(duplicateRequests[0]?.body.data.order.subOrders[0].items[0].lineTotal).toEqual({ amount: 450, currency: "NGN" });

    const allocated = await request(app).get("/api/v1/vendor/inventory").set("Cookie", vendorA.cookies).expect(200);
    expect(allocated.body.data.inventory[0]).toMatchObject({ quantityOnHand: 7, reservedQuantity: 2 });
    const ownReservations = await request(app).get("/api/v1/inventory/reservations/me").set("Cookie", customer.cookies).expect(200);
    expect(ownReservations.body.data.reservations).toHaveLength(0);

    const emptyCart = await request(app).get("/api/v1/cart").set("Cookie", customer.cookies).expect(200);
    expect(emptyCart.body.data.cart.items).toHaveLength(0);
    const mismatchedRetry = await withCsrf("post", "/api/v1/orders/checkout", customer)
      .set("Idempotency-Key", idempotencyKey).send({ ...checkout, shippingAddress: { ...checkout.shippingAddress, city: "Abuja" } })
      .expect(409);
    expect(mismatchedRetry.body.error.code).toBe("CONFLICT");

    const customerOrders = await request(app).get("/api/v1/orders/me").set("Cookie", customer.cookies).expect(200);
    expect(customerOrders.body.data.orders).toHaveLength(1);
    const order = await request(app).get(`/api/v1/orders/${orderId}`).set("Cookie", customer.cookies).expect(200);
    const otherOrders = await request(app).get(`/api/v1/orders/${orderId}`).set("Cookie", otherCustomer.cookies).expect(404);
    expect(otherOrders.body.error.code).toBe("NOT_FOUND");

    const vendorOrders = await request(app).get("/api/v1/vendor/orders").set("Cookie", vendorA.cookies).expect(200);
    expect(vendorOrders.body.data.orders).toHaveLength(1);
    expect(vendorOrders.body.data.orders[0].order).not.toHaveProperty("shippingAddress");
    const otherStoreOrderId = order.body.data.order.subOrders.find((entry: { store: { slug: string } }) => entry.store.slug !== vendorOrders.body.data.orders[0].store.slug).id as string;
    await request(app).get(`/api/v1/vendor/orders/${otherStoreOrderId}`).set("Cookie", vendorA.cookies).expect(404);

    await withCsrf("post", `/api/v1/orders/${orderId}/cancel`, customer).send({}).expect(200);
    await withCsrf("post", `/api/v1/orders/${orderId}/cancel`, customer).send({}).expect(409);
    const inventory = await request(app).get("/api/v1/vendor/inventory").set("Cookie", vendorA.cookies).expect(200);
    expect(inventory.body.data.inventory[0].quantityOnHand).toBe(10);
    expect(inventory.body.data.inventory[0].reservedQuantity).toBe(2);

    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemA.variantId, quantity: 1 }).expect(200);
    await withCsrf("put", "/api/v1/cart/items", customer).send({ variantId: itemB.variantId, quantity: 1 }).expect(200);
    const paymentCheckout = await checkoutBody(customer);
    const paymentIdempotencyKey = `payment-checkout-${suffix}`;
    idempotencyKeys.push(paymentIdempotencyKey);
    const paymentOrder = await withCsrf("post", "/api/v1/orders/checkout", customer)
      .set("Idempotency-Key", paymentIdempotencyKey).send(paymentCheckout).expect(201);
    const paymentOrderId = paymentOrder.body.data.order.id as string;

    const paymentKey = `payment-attempt-${suffix}`;
    const initialized = await withCsrf("post", `/api/v1/orders/${paymentOrderId}/payment`, customer)
      .set("Idempotency-Key", paymentKey).send({}).expect(201);
    const retried = await withCsrf("post", `/api/v1/orders/${paymentOrderId}/payment`, customer)
      .set("Idempotency-Key", paymentKey).send({}).expect(201);
    const reference = initialized.body.data.payment.reference as string;
    expect(retried.body.data.payment.reference).toBe(reference);
    expect(paystackMocks.initializeTransaction).toHaveBeenCalledTimes(1);

    const verifiedPayment = await withCsrf("post", "/api/v1/payments/verify", customer)
      .send({ reference }).expect(200);
    expect(verifiedPayment.body.data.payment.status).toBe("succeeded");
    const paidOrder = await request(app).get(`/api/v1/orders/${paymentOrderId}`).set("Cookie", customer.cookies).expect(200);
    expect(paidOrder.body.data.order.status).toBe("paid");
    expect(paidOrder.body.data.order.subOrders.every((entry: { status: string }) => entry.status === "confirmed")).toBe(true);
    const earnings = await request(app).get("/api/v1/vendor/earnings").set("Cookie", vendorA.cookies).expect(200);
    expect(earnings.body.data.earnings).toMatchObject({
      balance: { amount: 143, currency: "NGN" },
      available: { amount: 143, currency: "NGN" },
    });
    const vendorBEarnings = await request(app).get("/api/v1/vendor/earnings").set("Cookie", vendorB.cookies).expect(200);
    expect(vendorBEarnings.body.data.earnings.balance).toEqual({ amount: 238, currency: "NGN" });
    const payoutKeys = [`payout-a-${suffix}`, `payout-b-${suffix}`];
    const payoutAttempts = await Promise.all(payoutKeys.map((key) => withCsrf("post", "/api/v1/vendor/payouts", vendorA)
      .set("Idempotency-Key", key).send({ amount: 80 })));
    console.log("payout response diagnostic", payoutAttempts.map(({ status, body }) => ({ status, body })));
    expect(payoutAttempts.map(({ status }) => status).sort()).toEqual([201, 422]);
    const payoutIndex = payoutAttempts.findIndex(({ status }) => status === 201);
    const payout = payoutAttempts[payoutIndex];
    const payoutKey = payoutKeys[payoutIndex];
    expect(payout).toBeDefined();
    const payoutRetry = await withCsrf("post", "/api/v1/vendor/payouts", vendorA)
      .set("Idempotency-Key", payoutKey ?? "").send({ amount: 80 }).expect(201);
    expect(payoutRetry.body.data.payout.id).toBe(payout?.body.data.payout.id);
    await withCsrf("post", "/api/v1/vendor/payouts", vendorA)
      .set("Idempotency-Key", payoutKey ?? "").send({ amount: 79 }).expect(409);
    await withCsrf("post", `/api/v1/admin/payouts/${payout?.body.data.payout.id}/approve`, admin).send({}).expect(200);
    await withCsrf("post", `/api/v1/admin/payouts/${payout?.body.data.payout.id}/mark-paid`, admin)
      .send({ externalReference: `manual-transfer-${suffix.slice(0, 8)}` }).expect(200);
    const afterPayout = await request(app).get("/api/v1/vendor/earnings").set("Cookie", vendorA.cookies).expect(200);
    expect(afterPayout.body.data.earnings.available).toEqual({ amount: 63, currency: "NGN" });
    await withCsrf("post", "/api/v1/vendor/payouts", vendorA)
      .set("Idempotency-Key", `payout-over-balance-${suffix}`).send({ amount: 70 }).expect(422);
    const rejectedPayout = await withCsrf("post", "/api/v1/vendor/payouts", vendorA)
      .set("Idempotency-Key", `payout-rejected-${suffix}`).send({ amount: 20 }).expect(201);
    await withCsrf("post", `/api/v1/admin/payouts/${rejectedPayout.body.data.payout.id}/reject`, admin)
      .send({ reason: "Payout details need a review." }).expect(200);

    const webhook = { event: "charge.success", data: { id: 501, reference, status: "success" } };
    webhookEventKeys.push(`paystack:charge.success:501`);
    await request(app).post("/api/v1/payments/webhooks/paystack")
      .set("x-paystack-signature", "test-signature").send(webhook).expect(200);
    await request(app).post("/api/v1/payments/webhooks/paystack")
      .set("x-paystack-signature", "test-signature").send(webhook).expect(200);

    const payment = verifiedPayment.body.data.payment;
    const refundKey = `refund-request-${suffix}`;
    const refund = await withCsrf("post", `/api/v1/admin/payments/${payment.id}/refunds`, admin)
      .set("Idempotency-Key", refundKey).send({ amount: 150, reason: "Customer requested a partial refund." }).expect(201);
    const refundRetry = await withCsrf("post", `/api/v1/admin/payments/${payment.id}/refunds`, admin)
      .set("Idempotency-Key", refundKey).send({ amount: 150, reason: "Customer requested a partial refund." }).expect(201);
    expect(refundRetry.body.data.refund.id).toBe(refund.body.data.refund.id);
    expect(paystackMocks.createRefund).toHaveBeenCalledTimes(1);
    await withCsrf("post", `/api/v1/admin/payments/${payment.id}/refunds`, admin)
      .set("Idempotency-Key", `refund-too-large-${suffix}`).send({ amount: 300, reason: "Refund exceeds the remaining captured amount." }).expect(422);
    const refundWebhook = { event: "refund.processed", data: { transaction_reference: reference, refund_reference: null, amount: "150", status: "processed" } };
    webhookEventKeys.push(`paystack:refund.processed:${createHash("sha256").update(JSON.stringify(refundWebhook)).digest("hex")}`);
    await request(app).post("/api/v1/payments/webhooks/paystack")
      .set("x-paystack-signature", "test-signature")
      .send(refundWebhook)
      .expect(200);
    await request(app).post("/api/v1/payments/webhooks/paystack")
      .set("x-paystack-signature", "test-signature")
      .send(refundWebhook)
      .expect(200);
    const refunds = await request(app).get(`/api/v1/admin/payments/${payment.id}/refunds`).set("Cookie", admin.cookies).expect(200);
    expect(refunds.body.data.refunds).toHaveLength(1);
    expect(refunds.body.data.refunds[0].status).toBe("succeeded");
    const ledger = await request(app).get("/api/v1/vendor/ledger").set("Cookie", vendorA.cookies).expect(200);
    expect(ledger.body.data.entries.filter((entry: { type: string }) => entry.type === "refund_adjustment")).toHaveLength(1);
  });
});
