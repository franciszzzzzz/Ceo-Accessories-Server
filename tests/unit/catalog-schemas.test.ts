import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  productCreateSchema,
  publicProductListSchema,
  variantCreateSchema,
} from "../../src/modules/catalog/catalog.schemas.js";

describe("catalog request schemas", () => {
  it("rejects invalid slugs and caller-supplied category state", () => {
    expect(categoryCreateSchema.safeParse({ name: "Home", slug: "Not Valid", status: "archived" }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: "Home", slug: "home", status: "active" }).success).toBe(false);
  });

  it("defaults product categories and rejects non-integer money", () => {
    expect(productCreateSchema.parse({ name: "Tea Set", description: "Ceramic set" }).categoryIds).toEqual([]);
    expect(variantCreateSchema.safeParse({
      sku: "tea-set-1",
      options: { color: "White" },
      priceAmount: 1500.5,
    }).success).toBe(false);
  });

  it("normalizes SKU, fixes currency to NGN, and constrains public search", () => {
    expect(variantCreateSchema.parse({
      sku: " tea-1 ",
      options: { color: "White", size: "M" },
      priceAmount: 150_000,
    })).toMatchObject({ sku: "TEA-1", currency: "NGN", priceAmount: 150_000 });
    expect(publicProductListSchema.parse({ q: "  tea  " })).toMatchObject({ q: "tea", page: 1, limit: 20, sort: "newest" });
    expect(publicProductListSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
