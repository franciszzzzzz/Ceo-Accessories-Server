import { describe, expect, it } from "vitest";
import { checkoutSchema, idempotencyHeaderSchema } from "../../src/modules/orders/orders.schemas.js";

const address = {
  recipientName: "Ada Buyer",
  phone: "+2348012345678",
  addressLine1: "12 Market Street",
  city: "Lagos",
  state: "Lagos",
};

describe("checkout request schemas", () => {
  it("accepts a Nigerian delivery address and unique cart line", () => {
    const result = checkoutSchema.parse({
      shippingAddress: address,
      items: [{ variantId: "29004ee9-3b1b-44c9-8d4c-5f945005a182", quantity: 2, quotedPriceAmount: 1000 }],
    });
    expect(result.shippingAddress.countryCode).toBe("NG");
  });

  it("rejects duplicate variants, untrusted totals, and malformed idempotency keys", () => {
    const variantId = "29004ee9-3b1b-44c9-8d4c-5f945005a182";
    expect(checkoutSchema.safeParse({
      shippingAddress: address,
      items: [
        { variantId, quantity: 1, quotedPriceAmount: 100 },
        { variantId, quantity: 1, quotedPriceAmount: 100 },
      ],
    }).success).toBe(false);
    expect(checkoutSchema.safeParse({ shippingAddress: address, items: [], totalAmount: 1 }).success).toBe(false);
    expect(idempotencyHeaderSchema.safeParse({ key: "too-short" }).success).toBe(false);
    expect(idempotencyHeaderSchema.safeParse({ key: "phase7-checkout-key-123" }).success).toBe(true);
  });
});
