import { Prisma, OrderStatus, PaymentAttemptStatus, PaymentStatus, PaymentWebhookEventStatus, RefundStatus, SubOrderStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";

const attemptLifetimeMs = 30 * 60 * 1000;
const serializationRetries = 3;

const paymentStateSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  paidAt: true,
  createdAt: true,
  attempts: {
    select: { id: true, reference: true, status: true, authorizationUrl: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.PaymentSelect;

const refundSelect = {
  id: true,
  paymentId: true,
  providerRefundId: true,
  amount: true,
  currency: true,
  status: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RefundSelect;

export class PaymentConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConflict";
  }
}

export async function preparePaymentAttempt(userId: string, orderId: string, idempotencyKey: string, reference: string) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, totalAmount: true, currency: true, user: { select: { email: true } }, payment: { select: { id: true, status: true, amount: true, attempts: { select: { id: true, reference: true, idempotencyKey: true, status: true, authorizationUrl: true, expiresAt: true }, orderBy: { createdAt: "desc" } } } } },
    });
    if (!order) return { kind: "not_found" as const };
    if (order.status !== OrderStatus.pending_payment) return { kind: "not_payable" as const };
    if (!Number.isSafeInteger(Number(order.totalAmount)) || order.totalAmount <= 0n) return { kind: "amount_unsupported" as const };

    const payment = order.payment ?? await transaction.payment.create({
      data: { orderId, amount: order.totalAmount, currency: order.currency },
      select: { id: true, status: true, amount: true, attempts: { select: { id: true, reference: true, idempotencyKey: true, status: true, authorizationUrl: true, expiresAt: true } } },
    });
    if (payment.status === PaymentStatus.succeeded || payment.status === PaymentStatus.refunded || payment.status === PaymentStatus.partially_refunded) {
      return { kind: "already_paid" as const };
    }
    if (payment.status === PaymentStatus.needs_attention) return { kind: "needs_attention" as const };

    const now = new Date();
    const sameKey = payment.attempts.find((attempt) => attempt.idempotencyKey === idempotencyKey);
    if (sameKey) {
      return { kind: "existing" as const, attempt: sameKey, email: order.user.email, amount: Number(payment.amount), currency: order.currency };
    }
    const active = payment.attempts.find((attempt) =>
      (attempt.status === PaymentAttemptStatus.initializing || attempt.status === PaymentAttemptStatus.pending) && attempt.expiresAt > now);
    if (active) return { kind: "active" as const };

    await transaction.paymentAttempt.updateMany({
      where: { paymentId: payment.id, status: { in: [PaymentAttemptStatus.initializing, PaymentAttemptStatus.pending] }, expiresAt: { lte: now } },
      data: { status: PaymentAttemptStatus.expired, updatedAt: now },
    });
    const attempt = await transaction.paymentAttempt.create({
      data: { paymentId: payment.id, reference, idempotencyKey, expiresAt: new Date(now.getTime() + attemptLifetimeMs) },
      select: { id: true, reference: true, status: true, authorizationUrl: true, expiresAt: true },
    });
    await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.pending } });
    return { kind: "created" as const, attempt, email: order.user.email, amount: Number(payment.amount), currency: order.currency };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function completePaymentInitialization(attemptId: string, authorizationUrl: string) {
  return prisma.paymentAttempt.update({
    where: { id: attemptId },
    data: { status: PaymentAttemptStatus.pending, authorizationUrl },
    select: { id: true, reference: true, status: true, authorizationUrl: true, expiresAt: true },
  });
}

export async function failPaymentInitialization(attemptId: string) {
  await prisma.$transaction(async (transaction) => {
    const attempt = await transaction.paymentAttempt.update({
      where: { id: attemptId },
      data: { status: PaymentAttemptStatus.failed },
      select: { paymentId: true },
    });
    await transaction.payment.updateMany({
      where: { id: attempt.paymentId, status: PaymentStatus.pending },
      data: { status: PaymentStatus.failed },
    });
  });
}

export async function getOwnedPaymentAttempt(userId: string, reference: string) {
  return prisma.paymentAttempt.findFirst({
    where: { reference, payment: { is: { order: { is: { userId } } } } },
    select: {
      id: true,
      reference: true,
      status: true,
      payment: { select: { id: true, amount: true, currency: true, status: true, order: { select: { id: true, status: true } } } },
    },
  });
}

export async function getCustomerPayment(userId: string, orderId: string) {
  return prisma.payment.findFirst({ where: { order: { is: { id: orderId, userId } } }, select: paymentStateSelect });
}

export async function applyVerifiedTransaction(input: {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  transactionId: string;
  event?: { eventKey: string; eventType: string; payloadHash: string };
}) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    if (input.event) {
      const duplicate = await transaction.paymentWebhookEvent.findUnique({ where: { eventKey: input.event.eventKey }, select: { id: true } });
      if (duplicate) return { kind: "duplicate" as const };
    }
    const attempt = await transaction.paymentAttempt.findUnique({
      where: { reference: input.reference },
      select: { id: true, status: true, paymentId: true, payment: { select: { amount: true, currency: true, status: true, order: { select: { id: true, status: true } } } } },
    });
    if (!attempt) {
      if (input.event) await insertWebhookEvent(transaction, input.event, input.reference, PaymentWebhookEventStatus.ignored);
      return { kind: "not_found" as const };
    }
    const amountMatches = BigInt(input.amount) === attempt.payment.amount;
    const transactionMatches = input.currency === attempt.payment.currency && input.reference.length > 0;
    if (input.status === "success" && (!amountMatches || !transactionMatches)) {
      await transaction.payment.update({ where: { id: attempt.paymentId }, data: { status: PaymentStatus.needs_attention } });
      if (input.event) await insertWebhookEvent(transaction, input.event, input.reference, PaymentWebhookEventStatus.attention);
      return { kind: "mismatch" as const };
    }
    if (input.status !== "success") {
      if (attempt.status !== PaymentAttemptStatus.succeeded) {
        await transaction.paymentAttempt.update({ where: { id: attempt.id }, data: { status: PaymentAttemptStatus.failed, verifiedAt: new Date() } });
        await transaction.payment.updateMany({ where: { id: attempt.paymentId, status: PaymentStatus.pending }, data: { status: PaymentStatus.failed } });
      }
      if (input.event) await insertWebhookEvent(transaction, input.event, input.reference, PaymentWebhookEventStatus.processed);
      return { kind: "failed" as const };
    }
    if (attempt.status === PaymentAttemptStatus.succeeded && attempt.payment.status === PaymentStatus.succeeded) {
      if (input.event) await insertWebhookEvent(transaction, input.event, input.reference, PaymentWebhookEventStatus.processed);
      return { kind: "succeeded" as const };
    }

    const now = new Date();
    await transaction.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: PaymentAttemptStatus.succeeded, providerTransactionId: input.transactionId, verifiedAt: now },
    });
    await transaction.payment.update({ where: { id: attempt.paymentId }, data: { status: PaymentStatus.succeeded, paidAt: now } });
    if (attempt.payment.order.status === OrderStatus.pending_payment) {
      await transaction.order.update({ where: { id: attempt.payment.order.id }, data: { status: OrderStatus.paid } });
      await transaction.subOrder.updateMany({
        where: { orderId: attempt.payment.order.id, status: SubOrderStatus.pending },
        data: { status: SubOrderStatus.confirmed, updatedAt: now },
      });
    } else if (attempt.payment.order.status === OrderStatus.cancelled) {
      await transaction.payment.update({ where: { id: attempt.paymentId }, data: { status: PaymentStatus.needs_attention } });
      await transaction.refund.upsert({
        where: { paymentId_idempotencyKey: { paymentId: attempt.paymentId, idempotencyKey: `late-payment-${input.reference}` } },
        create: {
          paymentId: attempt.paymentId,
          idempotencyKey: `late-payment-${input.reference}`,
          amount: attempt.payment.amount,
          reason: "A payment completed after its order was cancelled; admin refund action is required.",
          status: RefundStatus.needs_attention,
        },
        update: {},
      });
    }
    if (input.event) await insertWebhookEvent(transaction, input.event, input.reference, PaymentWebhookEventStatus.processed);
    return { kind: "succeeded" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function prepareRefund(input: {
  paymentId: string;
  adminId: string;
  idempotencyKey: string;
  amount?: bigint;
  reason: string;
}) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const existing = await transaction.refund.findUnique({
      where: { paymentId_idempotencyKey: { paymentId: input.paymentId, idempotencyKey: input.idempotencyKey } },
      select: refundSelect,
    });
    if (existing) return { kind: "existing" as const, refund: existing };
    const payment = await transaction.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        attempts: { where: { status: PaymentAttemptStatus.succeeded }, orderBy: { verifiedAt: "desc" }, take: 1, select: { reference: true } },
      },
    });
    if (!payment) return { kind: "not_found" as const };
    if (payment.status !== PaymentStatus.succeeded && payment.status !== PaymentStatus.partially_refunded) return { kind: "not_refundable" as const };
    const reserved = await transaction.refund.aggregate({
      where: { paymentId: payment.id, status: { in: [RefundStatus.pending, RefundStatus.processing, RefundStatus.succeeded, RefundStatus.needs_attention] } },
      _sum: { amount: true },
    });
    const remaining = payment.amount - (reserved._sum.amount ?? 0n);
    const amount = input.amount ?? remaining;
    if (amount <= 0n || amount > remaining) return { kind: "amount_invalid" as const, remaining };
    const attempt = payment.attempts[0];
    if (!attempt) return { kind: "not_refundable" as const };
    const refund = await transaction.refund.create({
      data: {
        paymentId: payment.id,
        initiatedById: input.adminId,
        idempotencyKey: input.idempotencyKey,
        amount,
        currency: payment.currency,
        reason: input.reason,
      },
      select: refundSelect,
    });
    return { kind: "created" as const, refund, reference: attempt.reference };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateRefundProviderResult(refundId: string, providerRefundId: string, providerStatus: string) {
  const status = mapRefundStatus(providerStatus);
  return prisma.$transaction(async (transaction) => {
    const refund = await transaction.refund.update({
      where: { id: refundId },
      data: { providerRefundId, status },
      select: { paymentId: true, amount: true, status: true },
    });
    await updatePaymentRefundStatus(transaction, refund.paymentId);
    return transaction.refund.findUniqueOrThrow({ where: { id: refundId }, select: refundSelect });
  });
}

export async function markRefundNeedsAttention(refundId: string) {
  return prisma.refund.update({ where: { id: refundId }, data: { status: RefundStatus.needs_attention }, select: refundSelect });
}

export async function findAdminPaymentRefunds(paymentId: string) {
  return prisma.refund.findMany({ where: { paymentId }, select: refundSelect, orderBy: { createdAt: "desc" } });
}

export async function processRefundWebhook(input: {
  event: { eventKey: string; eventType: string; payloadHash: string };
  providerRefundId?: string;
  transactionReference?: string;
  amount?: bigint;
  providerStatus: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.paymentWebhookEvent.findUnique({ where: { eventKey: input.event.eventKey }, select: { id: true } });
    if (duplicate) return { kind: "duplicate" as const };
    const canResolveRefund = Boolean(input.providerRefundId || (input.transactionReference && input.amount !== undefined));
    const eventStatus = canResolveRefund ? PaymentWebhookEventStatus.processed : PaymentWebhookEventStatus.ignored;
    await insertWebhookEvent(transaction, input.event, null, eventStatus);
    if (!canResolveRefund) return { kind: "ignored" as const };
    let refund = input.providerRefundId
      ? await transaction.refund.findFirst({ where: { providerRefundId: input.providerRefundId }, select: { id: true, paymentId: true } })
      : null;
    if (!refund && input.transactionReference && input.amount !== undefined) {
      const matches = await transaction.refund.findMany({
        where: {
          amount: input.amount,
          status: { in: [RefundStatus.pending, RefundStatus.processing, RefundStatus.needs_attention] },
          payment: { is: { attempts: { some: { reference: input.transactionReference } } } },
        },
        select: { id: true, paymentId: true },
        take: 2,
      });
      if (matches.length === 1) refund = matches[0] ?? null;
    }
    if (!refund) return { kind: "ignored" as const };
    const status = mapRefundStatus(input.providerStatus);
    await transaction.refund.update({
      where: { id: refund.id },
      data: {
        ...(input.providerRefundId ? { providerRefundId: input.providerRefundId } : {}),
        status,
      },
    });
    await updatePaymentRefundStatus(transaction, refund.paymentId);
    return { kind: "processed" as const, refundId: refund.id, status };
  });
}

async function insertWebhookEvent(
  transaction: Prisma.TransactionClient,
  event: { eventKey: string; eventType: string; payloadHash: string },
  reference: string | null,
  status: PaymentWebhookEventStatus,
): Promise<void> {
  await transaction.paymentWebhookEvent.create({
    data: { ...event, reference, status },
  });
}

async function updatePaymentRefundStatus(transaction: Prisma.TransactionClient, paymentId: string): Promise<void> {
  const totals = await transaction.refund.groupBy({
    by: ["status"],
    where: { paymentId },
    _sum: { amount: true },
  });
  const succeeded = totals.find(({ status }) => status === RefundStatus.succeeded)?._sum.amount ?? 0n;
  const attention = totals.some(({ status }) => status === RefundStatus.needs_attention);
  const payment = await transaction.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, status: true } });
  if (attention) {
    await transaction.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.needs_attention } });
  } else if (succeeded >= payment.amount) {
    await transaction.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.refunded } });
  } else if (succeeded > 0n) {
    await transaction.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.partially_refunded } });
  }
}

function mapRefundStatus(status: string): RefundStatus {
  switch (status) {
    case "pending": return RefundStatus.pending;
    case "processing": return RefundStatus.processing;
    case "processed": return RefundStatus.succeeded;
    case "failed": return RefundStatus.failed;
    default: return RefundStatus.needs_attention;
  }
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt >= serializationRetries - 1) throw error;
    }
  }
}
