import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(128),
}).strict();

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
}).strict();

export const passwordResetCompleteSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128),
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
