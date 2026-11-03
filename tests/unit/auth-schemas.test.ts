import { describe, expect, it } from "vitest";
import {
  loginSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  registerSchema,
} from "../../src/modules/auth/auth.schemas.js";

describe("authentication request schemas", () => {
  it("normalizes emails and rejects caller-assigned role fields", () => {
    expect(registerSchema.parse({ email: "  SHOPPER@EXAMPLE.COM ", password: "long-enough-password" })).toEqual({
      email: "shopper@example.com",
      password: "long-enough-password",
    });
    expect(registerSchema.safeParse({ email: "shopper@example.com", password: "long-enough-password", role: "admin" }).success).toBe(false);
  });

  it("rejects weak registration and reset passwords", () => {
    expect(registerSchema.safeParse({ email: "shopper@example.com", password: "short" }).success).toBe(false);
    expect(passwordResetCompleteSchema.safeParse({ token: "x".repeat(32), password: "short" }).success).toBe(false);
  });

  it("validates login and reset request shapes", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "secret" }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({ email: "shopper@example.com", extra: true }).success).toBe(false);
  });
});
