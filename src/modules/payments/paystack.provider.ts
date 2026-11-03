import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";

const apiBaseUrl = "https://api.paystack.co";
const requestTimeoutMs = 10_000;

const envelopeSchema = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z.unknown(),
}).passthrough();

export class PaystackNotConfiguredError extends Error {
  constructor() {
    super("Paystack is not configured.");
    this.name = "PaystackNotConfiguredError";
  }
}

export class PaystackRequestError extends Error {
  constructor() {
    super("Paystack request failed.");
    this.name = "PaystackRequestError";
  }
}

export interface VerifiedPaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  transactionId: string;
}

export function assertPaystackConfigured(): void {
  if (!env.paystackSecretKey) throw new PaystackNotConfiguredError();
}

export async function initializeTransaction(input: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
}, secretKey?: string, fetcher: typeof fetch = fetch): Promise<{ authorizationUrl: string; transactionId: string }> {
  const response = await requestPaystack("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(input),
  }, secretKey, fetcher);
  const schema = z.object({
    authorization_url: z.string().url(),
    reference: z.string().min(1),
    access_code: z.string().min(1),
  }).passthrough();
  const parsed = schema.safeParse(response.data);
  if (!parsed.success || parsed.data.reference !== input.reference) throw new PaystackRequestError();
  return { authorizationUrl: parsed.data.authorization_url, transactionId: parsed.data.access_code };
}

export async function verifyTransaction(reference: string, secretKey?: string, fetcher: typeof fetch = fetch): Promise<VerifiedPaystackTransaction> {
  const response = await requestPaystack(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }, secretKey, fetcher);
  const schema = z.object({
    id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    reference: z.string().min(1),
    status: z.string().min(1),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }).passthrough();
  const parsed = schema.safeParse(response.data);
  if (!parsed.success || parsed.data.reference !== reference) throw new PaystackRequestError();
  return {
    reference: parsed.data.reference,
    status: parsed.data.status,
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    transactionId: String(parsed.data.id),
  };
}

export async function createRefund(
  input: { reference: string; amount: number; reason: string },
  secretKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ providerRefundId: string; status: string }> {
  const response = await requestPaystack("/refund", {
    method: "POST",
    body: JSON.stringify({ transaction: input.reference, amount: input.amount, customer_note: input.reason, merchant_note: input.reason }),
  }, secretKey, fetcher);
  const parsed = z.object({ id: z.union([z.number().int().nonnegative(), z.string().min(1)]), status: z.string().min(1) })
    .passthrough().safeParse(response.data);
  if (!parsed.success) throw new PaystackRequestError();
  return { providerRefundId: String(parsed.data.id), status: parsed.data.status };
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secretKey?: string): boolean {
  const secret = secretKey ?? env.paystackSecretKey;
  if (!secret) throw new PaystackNotConfiguredError();
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function requestPaystack(
  path: string,
  input: { method: "GET" | "POST"; body?: string },
  secretKey?: string,
  fetcher: typeof fetch = fetch,
) {
  const secret = secretKey ?? env.paystackSecretKey;
  if (!secret) throw new PaystackNotConfiguredError();
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl}${path}`, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body ? { body: input.body } : {}),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new PaystackRequestError();
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = envelopeSchema.safeParse(body);
  if (!response.ok || !parsed.success || !parsed.data.status) throw new PaystackRequestError();
  return parsed.data;
}
