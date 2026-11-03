import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import * as repository from "./admin.repository.js";

const emailSchema = z.string().trim().toLowerCase().email().max(320);

export async function grantAdminByEmail(value: string): Promise<"granted" | "already_admin"> {
  const parsedEmail = emailSchema.safeParse(value);
  if (!parsedEmail.success) throw new AppError(400, "VALIDATION_ERROR", "Provide a valid existing account email.");
  const result = await repository.grantAdminRole(parsedEmail.data);
  if (result === "not_found") throw new AppError(404, "NOT_FOUND", "No account exists for that email.");
  return result;
}
