import { describe, expect, it } from "vitest";
import { inventoryListSchema, inventoryUpdateSchema, reservationCreateSchema } from "../../src/modules/inventory/inventory.schemas.js";

describe("inventory request schemas", () => {
  it("parses pagination and low-stock filters", () => {
    expect(inventoryListSchema.parse({ page: "2", limit: "15", lowStockOnly: "true" })).toEqual({
      page: 2,
      limit: 15,
      lowStockOnly: true,
    });
  });

  it("rejects negative stock and empty updates", () => {
    expect(inventoryUpdateSchema.safeParse({ quantityOnHand: -1 }).success).toBe(false);
    expect(inventoryUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("requires positive integer reservation quantities and rejects unknown fields", () => {
    const variantId = "aa3bb815-43a8-472f-9fca-3fa72d35a341";
    expect(reservationCreateSchema.safeParse({ variantId, quantity: 1 }).success).toBe(true);
    expect(reservationCreateSchema.safeParse({ variantId, quantity: 0 }).success).toBe(false);
    expect(reservationCreateSchema.safeParse({ variantId, quantity: 1, userId: "spoofed" }).success).toBe(false);
  });
});
