import { describe, expect, it } from "vitest";
import { cartItemCreateSchema, cartItemUpdateSchema } from "../../src/modules/cart/cart.schemas.js";

describe("cart request schemas", () => {
  it("accepts a valid variant and target quantity", () => {
    const variantId = "29004ee9-3b1b-44c9-8d4c-5f945005a182";
    expect(cartItemCreateSchema.parse({ variantId, quantity: 2 })).toEqual({ variantId, quantity: 2 });
    expect(cartItemUpdateSchema.parse({ quantity: 1 })).toEqual({ quantity: 1 });
  });

  it("rejects zero, fractional, out-of-range, and unknown client price fields", () => {
    const variantId = "29004ee9-3b1b-44c9-8d4c-5f945005a182";
    expect(cartItemCreateSchema.safeParse({ variantId, quantity: 0 }).success).toBe(false);
    expect(cartItemCreateSchema.safeParse({ variantId, quantity: 1.5 }).success).toBe(false);
    expect(cartItemCreateSchema.safeParse({ variantId, quantity: 1, priceAmount: 1 }).success).toBe(false);
  });
});
