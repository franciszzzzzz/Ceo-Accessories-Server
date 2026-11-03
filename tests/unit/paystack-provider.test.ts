import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createRefund,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
} from "../../src/modules/payments/paystack.provider.js";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ status: status >= 200 && status < 300, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Paystack provider adapter", () => {
  it("initializes a transaction using the server supplied amount and reference", async () => {
    const fetcher = vi.fn(async () => response({
      authorization_url: "https://checkout.paystack.com/example",
      reference: "marketplace_reference",
      access_code: "access-code",
    }));
    const result = await initializeTransaction({
      email: "buyer@example.com",
      amount: 1234,
      currency: "NGN",
      reference: "marketplace_reference",
    }, "sk_test_for_unit_tests", fetcher);

    expect(result).toEqual({ authorizationUrl: "https://checkout.paystack.com/example", transactionId: "access-code" });
    expect(fetcher).toHaveBeenCalledWith("https://api.paystack.co/transaction/initialize", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer sk_test_for_unit_tests" }),
      body: JSON.stringify({ email: "buyer@example.com", amount: 1234, currency: "NGN", reference: "marketplace_reference" }),
    }));
  });

  it("verifies the provider transaction reference and returns captured fields", async () => {
    const fetcher = vi.fn(async () => response({
      id: 42,
      reference: "marketplace_reference",
      status: "success",
      amount: 1234,
      currency: "NGN",
    }));
    await expect(verifyTransaction("marketplace_reference", "sk_test_for_unit_tests", fetcher)).resolves.toEqual({
      reference: "marketplace_reference",
      status: "success",
      amount: 1234,
      currency: "NGN",
      transactionId: "42",
    });
    expect(fetcher).toHaveBeenCalledWith("https://api.paystack.co/transaction/verify/marketplace_reference", expect.objectContaining({ method: "GET" }));
  });

  it("creates a refund against the provider reference in minor units", async () => {
    const fetcher = vi.fn(async () => response({ id: 77, status: "pending" }));
    await expect(createRefund({ reference: "marketplace_reference", amount: 1234, reason: "Approved request" }, "sk_test_for_unit_tests", fetcher))
      .resolves.toEqual({ providerRefundId: "77", status: "pending" });
    expect(fetcher).toHaveBeenCalledWith("https://api.paystack.co/refund", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ transaction: "marketplace_reference", amount: 1234, customer_note: "Approved request", merchant_note: "Approved request" }),
    }));
  });

  it("checks webhook signatures over the exact raw bytes and rejects malformed or changed signatures", () => {
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac("sha512", "unit-test-secret").update(rawBody).digest("hex");
    expect(verifyWebhookSignature(rawBody, signature, "unit-test-secret")).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(`${rawBody.toString()} `), signature, "unit-test-secret")).toBe(false);
    expect(verifyWebhookSignature(rawBody, "not-a-signature", "unit-test-secret")).toBe(false);
    expect(verifyWebhookSignature(rawBody, undefined, "unit-test-secret")).toBe(false);
  });
});
