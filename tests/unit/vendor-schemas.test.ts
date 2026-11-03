import { describe, expect, it } from "vitest";
import { applicationSchema, rejectionSchema } from "../../src/modules/vendors/vendor.schemas.js";
import { storeUpdateSchema } from "../../src/modules/vendors/store.schemas.js";

describe("vendor onboarding schemas", () => {
  it("accepts the minimal business application and normalizes text", () => {
    expect(applicationSchema.parse({
      businessName: "  Market House ",
      storeName: " Market House Store ",
      contactPhone: "+2348012345678",
    })).toEqual({
      businessName: "Market House",
      storeName: "Market House Store",
      contactPhone: "+2348012345678",
    });
  });

  it("rejects non-E.164 phones, unknown privilege fields, and short rejection reasons", () => {
    expect(applicationSchema.safeParse({
      businessName: "Market House",
      storeName: "Market House Store",
      contactPhone: "08012345678",
    }).success).toBe(false);
    expect(applicationSchema.safeParse({
      businessName: "Market House",
      storeName: "Market House Store",
      contactPhone: "+2348012345678",
      status: "approved",
      role: "admin",
    }).success).toBe(false);
    expect(rejectionSchema.safeParse({ reason: "No" }).success).toBe(false);
  });

  it("requires a meaningful store patch and accepts only safe lowercase slugs", () => {
    expect(storeUpdateSchema.safeParse({}).success).toBe(false);
    expect(storeUpdateSchema.safeParse({ slug: "Valid-store-1" }).success).toBe(false);
    expect(storeUpdateSchema.safeParse({ slug: "valid-store-1" }).success).toBe(true);
  });
});
