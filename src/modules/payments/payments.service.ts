import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import type { RefundCreateInput, PaystackWebhookInput } from "./payments.schemas.js";
import * as repository from "./payments.repository.js";
import * as commissions from "../commissions/commissions.service.js";
import {
  assertPaystackConfigured,
  createRefund as createPaystackRefund,
  initializeTransaction,
  PaystackNotConfiguredError,
  PaystackRequestError,
  verifyTransaction,
  verifyWebhookSignature,
} from "./paystack.provider.js";

const paymentAttemptReferencePrefix = "marketplace_";

export async function initiatePayment(userId: string, orderId: string, idempotencyKey: string) {
  assertConfigured();
  const result = await repository.preparePaymentAttempt(
    userId,
    orderId,
    idempotencyKey,
    `${paymentAttemptReferencePrefix}${randomUUID().replaceAll("-", "")}`,
  );
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Order not found.");
  if (result.kind === "not_payable" || result.kind === "already_paid") {
    throw new AppError(409, "CONFLICT", "This order is not awaiting payment.");
  }
  if (result.kind === "amount_unsupported") throw new AppError(422, "UNPROCESSABLE", "Order amount exceeds the supported payment range.");
  if (result.kind === "needs_attention") throw new AppError(409, "CONFLICT", "Payment requires admin review before another attempt.");
  if (result.kind === "active") throw new AppError(409, "CONFLICT", "A payment attempt is already active for this order.");
  if (result.kind === "existing") {
    if (!result.attempt.authorizationUrl) throw new AppError(409, "CONFLICT", "This payment attempt is still being initialized or has already ended.");
    return { payment: { reference: result.attempt.reference, status: result.attempt.status, authorizationUrl: result.attempt.authorizationUrl, expiresAt: result.attempt.expiresAt } };
  }

  try {
    const initialized = await initializeTransaction({
      email: result.email,
      amount: result.amount,
      currency: result.currency,
      reference: result.attempt.reference,
    });
    const attempt = await repository.completePaymentInitialization(result.attempt.id, initialized.authorizationUrl);
    return { payment: { reference: attempt.reference, status: attempt.status, authorizationUrl: attempt.authorizationUrl, expiresAt: attempt.expiresAt } };
  } catch (error) {
    await repository.failPaymentInitialization(result.attempt.id);
    throw mapProviderError(error);
  }
}

export async function verifyCustomerPayment(userId: string, reference: string) {
  assertConfigured();
  const attempt = await repository.getOwnedPaymentAttempt(userId, reference);
  if (!attempt) throw new AppError(404, "NOT_FOUND", "Payment attempt not found.");
  if (attempt.payment.status === "succeeded" && attempt.status === "succeeded") {
    await commissions.recordEarningsForReference(reference);
    return getCustomerPayment(userId, attempt.payment.order.id);
  }
  const verified = await verifyWithProvider(reference);
  const result = await repository.applyVerifiedTransaction(verified);
  if (result.kind === "mismatch") throw new AppError(409, "CONFLICT", "Provider transaction amount or currency does not match the order.");
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Payment attempt not found.");
  if (verified.status === "success") await commissions.recordEarningsForReference(reference);
  return getCustomerPayment(userId, attempt.payment.order.id);
}

export async function getCustomerPayment(userId: string, orderId: string) {
  const payment = await repository.getCustomerPayment(userId, orderId);
  if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found.");
  return serializePayment(payment);
}

export async function handlePaystackWebhook(rawBody: Buffer, signature: string | undefined, payload: PaystackWebhookInput) {
  assertConfigured();
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid payment webhook signature.");
  }
  const externalId = payload.data.id === undefined ? createHash("sha256").update(rawBody).digest("hex") : String(payload.data.id);
  const event = {
    eventKey: `paystack:${payload.event}:${externalId}`,
    eventType: payload.event,
    payloadHash: createHash("sha256").update(rawBody).digest("hex"),
  };

  if (payload.event === "charge.success" || payload.event === "charge.failed") {
    if (!payload.data.reference) {
      await repository.processRefundWebhook({ event, providerStatus: "unknown" });
      return { acknowledged: true };
    }
    const verified = await verifyWithProvider(payload.data.reference);
    await repository.applyVerifiedTransaction({ ...verified, event });
    if (verified.status === "success") await commissions.recordEarningsForReference(payload.data.reference);
    return { acknowledged: true };
  }

  if (payload.event.startsWith("refund.")) {
    await repository.processRefundWebhook({
      event,
      ...(payload.data.refund_reference === undefined || payload.data.refund_reference === null
        ? {}
        : { providerRefundId: String(payload.data.refund_reference) }),
      ...(payload.data.transaction_reference === undefined ? {} : { transactionReference: payload.data.transaction_reference }),
      ...(payload.data.amount === undefined ? {} : { amount: BigInt(payload.data.amount) }),
      providerStatus: payload.data.status ?? payload.event.slice("refund.".length),
    });
    if ((payload.data.status ?? payload.event.slice("refund.".length)) === "processed"
      && payload.data.transaction_reference && payload.data.amount !== undefined) {
      await commissions.recordRefundEarningsForReference(payload.data.transaction_reference, BigInt(payload.data.amount));
    }
    return { acknowledged: true };
  }

  await repository.processRefundWebhook({ event, providerStatus: "ignored" });
  return { acknowledged: true };
}

export async function createAdminRefund(paymentId: string, adminId: string, idempotencyKey: string, input: RefundCreateInput) {
  assertConfigured();
  const result = await repository.prepareRefund({
    paymentId,
    adminId,
    idempotencyKey,
    ...(input.amount !== undefined ? { amount: BigInt(input.amount) } : {}),
    reason: input.reason,
  });
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Payment not found.");
  if (result.kind === "not_refundable") throw new AppError(409, "CONFLICT", "Only captured payments can be refunded.");
  if (result.kind === "amount_invalid") {
    throw new AppError(422, "UNPROCESSABLE", "Refund amount exceeds the remaining refundable amount.", {
      remainingAmount: safeAmount(result.remaining),
    });
  }
  if (result.kind === "existing") return { refund: serializeRefund(result.refund) };

  try {
    const providerResult = await createPaystackRefund({
      reference: result.reference,
      amount: safeAmount(result.refund.amount),
      reason: input.reason,
    });
    const refund = await repository.updateRefundProviderResult(result.refund.id, providerResult.providerRefundId, providerResult.status);
    if (refund.status === "succeeded") await commissions.recordRefundEarnings(refund.id);
    return { refund: serializeRefund(refund) };
  } catch (error) {
    await repository.markRefundNeedsAttention(result.refund.id);
    throw mapProviderError(error);
  }
}

export async function listAdminRefunds(paymentId: string) {
  const refunds = await repository.findAdminPaymentRefunds(paymentId);
  return { refunds: refunds.map(serializeRefund) };
}

async function verifyWithProvider(reference: string) {
  try {
    return await verifyTransaction(reference);
  } catch (error) {
    throw mapProviderError(error);
  }
}

function serializePayment(payment: Awaited<ReturnType<typeof repository.getCustomerPayment>> & {}) {
  return {
    id: payment.id,
    amount: { amount: safeAmount(payment.amount), currency: payment.currency },
    status: payment.status,
    paidAt: payment.paidAt,
    attempts: payment.attempts.map((attempt) => ({
      reference: attempt.reference,
      status: attempt.status,
      authorizationUrl: attempt.authorizationUrl,
      expiresAt: attempt.expiresAt,
      createdAt: attempt.createdAt,
    })),
    createdAt: payment.createdAt,
  };
}

function serializeRefund(refund: { id: string; amount: bigint; currency: string; status: string; reason: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: refund.id,
    amount: { amount: safeAmount(refund.amount), currency: refund.currency },
    status: refund.status,
    reason: refund.reason,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

function safeAmount(amount: bigint): number {
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) throw new AppError(500, "INTERNAL_ERROR", "Stored payment amount exceeds the supported API range.");
  return value;
}

function assertConfigured(): void {
  try {
    assertPaystackConfigured();
  } catch (error) {
    throw mapProviderError(error);
  }
}

function mapProviderError(error: unknown): AppError {
  if (error instanceof PaystackNotConfiguredError || error instanceof PaystackRequestError) {
    return new AppError(503, "SERVICE_UNAVAILABLE", error.message);
  }
  if (error instanceof repository.PaymentConflict) return new AppError(409, "CONFLICT", error.message);
  return error instanceof AppError ? error : new AppError(503, "SERVICE_UNAVAILABLE", "Payment provider is temporarily unavailable.");
}
