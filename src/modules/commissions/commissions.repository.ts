import { LedgerEntryType, PayoutStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import type { CommissionRuleInput } from "./commissions.schemas.js";

const retries = 3;
const ruleSelect = {
  id: true,
  storeId: true,
  categoryId: true,
  rateBasisPoints: true,
  effectiveFrom: true,
  effectiveUntil: true,
  createdAt: true,
  store: { select: { name: true } },
  category: { select: { name: true } },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.CommissionRuleSelect;
const payoutSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  externalReference: true,
  rejectionReason: true,
  requestedAt: true,
  approvedAt: true,
  rejectedAt: true,
  completedAt: true,
  store: { select: { id: true, name: true, slug: true, ownerId: true } },
} satisfies Prisma.PayoutSelect;

export class CommissionRuleConflict extends Error {}
export class PayoutConflict extends Error {}

export async function createCommissionRule(createdById: string, input: CommissionRuleInput) {
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const overlaps = await transaction.commissionRule.findFirst({
      where: {
        storeId: input.storeId ?? null,
        categoryId: input.categoryId ?? null,
        effectiveFrom: { lt: effectiveUntil ?? new Date("9999-12-31T23:59:59.999Z") },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlaps) throw new CommissionRuleConflict();
    return transaction.commissionRule.create({
      data: {
        createdById,
        storeId: input.storeId ?? null,
        categoryId: input.categoryId ?? null,
        rateBasisPoints: input.rateBasisPoints,
        effectiveFrom,
        effectiveUntil,
      },
      select: ruleSelect,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listCommissionRules(page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.commissionRule.findMany({ select: ruleSelect, orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.commissionRule.count(),
  ]);
  return { items, total };
}

export async function endCommissionRule(id: string, effectiveUntil: Date) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const rule = await transaction.commissionRule.findUnique({ where: { id }, select: { effectiveFrom: true, effectiveUntil: true } });
    if (!rule) return { kind: "not_found" as const };
    if (rule.effectiveUntil || effectiveUntil <= rule.effectiveFrom || effectiveUntil <= new Date()) return { kind: "conflict" as const };
    return { kind: "ok" as const, rule: await transaction.commissionRule.update({ where: { id }, data: { effectiveUntil }, select: ruleSelect }) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function recordOrderEarnings(orderId: string): Promise<void> {
  await withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        payment: { select: { id: true, status: true, paidAt: true } },
        subOrders: {
          select: {
            id: true,
            storeId: true,
            totalAmount: true,
            currency: true,
            items: { select: { id: true, lineTotalAmount: true, categoryIds: true } },
          },
        },
      },
    });
    if (!order || order.status !== "paid" || order.payment?.status !== "succeeded" || !order.payment.paidAt) return;
    const rules = await transaction.commissionRule.findMany({
      where: {
        effectiveFrom: { lte: order.payment.paidAt },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: order.payment.paidAt } }],
      },
      select: { id: true, storeId: true, categoryId: true, rateBasisPoints: true, effectiveFrom: true },
    });

    for (const subOrder of order.subOrders) {
      let commission = 0n;
      for (const item of subOrder.items) {
        const applicable = rules.filter((rule) =>
          (rule.storeId === null || rule.storeId === subOrder.storeId)
          && (rule.categoryId === null || item.categoryIds.includes(rule.categoryId)));
        applicable.sort((left, right) => {
          const leftSpecificity = Number(left.storeId !== null) + Number(left.categoryId !== null);
          const rightSpecificity = Number(right.storeId !== null) + Number(right.categoryId !== null);
          return rightSpecificity - leftSpecificity
            || right.effectiveFrom.getTime() - left.effectiveFrom.getTime()
            || left.id.localeCompare(right.id);
        });
        const basisPoints = applicable[0]?.rateBasisPoints ?? 0;
        commission += (item.lineTotalAmount * BigInt(basisPoints)) / 10_000n;
      }
      const gross = subOrder.totalAmount;
      await transaction.ledgerEntry.upsert({
        where: { sourceKey: `payment:${order.payment.id}:suborder:${subOrder.id}:sale` },
        create: {
          storeId: subOrder.storeId,
          subOrderId: subOrder.id,
          type: LedgerEntryType.vendor_sale,
          amount: gross,
          currency: subOrder.currency,
          sourceKey: `payment:${order.payment.id}:suborder:${subOrder.id}:sale`,
          description: "Gross vendor sale from paid order.",
        },
        update: {},
      });
      await transaction.ledgerEntry.upsert({
        where: { sourceKey: `payment:${order.payment.id}:suborder:${subOrder.id}:commission` },
        create: {
          storeId: subOrder.storeId,
          subOrderId: subOrder.id,
          type: LedgerEntryType.platform_commission,
          amount: -commission,
          currency: subOrder.currency,
          sourceKey: `payment:${order.payment.id}:suborder:${subOrder.id}:commission`,
          description: "Platform commission withheld from paid order.",
        },
        update: {},
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function recordEarningsForReference(reference: string): Promise<void> {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { reference }, select: { payment: { select: { orderId: true } } } });
  if (attempt) await recordOrderEarnings(attempt.payment.orderId);
}

export async function recordRefundEarnings(refundId: string): Promise<void> {
  const refundContext = await prisma.refund.findUnique({
    where: { id: refundId },
    select: { status: true, payment: { select: { orderId: true, order: { select: { status: true } } } } },
  });
  if (refundContext?.status === "succeeded" && refundContext.payment.order.status === "paid") {
    await recordOrderEarnings(refundContext.payment.orderId);
  }
  await withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const refund = await transaction.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        amount: true,
        status: true,
        payment: {
          select: {
            order: {
              select: {
                subOrders: { select: { id: true, storeId: true, totalAmount: true, currency: true } },
              },
            },
          },
        },
      },
    });
    if (!refund || refund.status !== "succeeded") return;
    const subOrders = [...refund.payment.order.subOrders].sort((left, right) => left.id.localeCompare(right.id));
    const totalGross = subOrders.reduce((sum, item) => sum + item.totalAmount, 0n);
    if (totalGross <= 0n) return;
    let allocatedSoFar = 0n;
    let grossSoFar = 0n;
    for (const subOrder of subOrders) {
      grossSoFar += subOrder.totalAmount;
      const cumulativeShare = (refund.amount * grossSoFar) / totalGross;
      const grossRefund = cumulativeShare - allocatedSoFar;
      allocatedSoFar = cumulativeShare;
      if (grossRefund <= 0n) continue;
      const sale = await transaction.ledgerEntry.findFirst({ where: { subOrderId: subOrder.id, type: LedgerEntryType.vendor_sale }, select: { amount: true } });
      const saleAmount = sale?.amount ?? subOrder.totalAmount;
      const commissionEntry = await transaction.ledgerEntry.findFirst({
        where: { subOrderId: subOrder.id, type: LedgerEntryType.platform_commission },
        select: { amount: true },
      });
      const commissionRefund = saleAmount > 0n ? ((commissionEntry?.amount ?? 0n) * -grossRefund) / saleAmount : 0n;
      const key = `refund:${refund.id}:suborder:${subOrder.id}`;
      await transaction.ledgerEntry.upsert({
        where: { sourceKey: `${key}:adjustment` },
        create: {
          storeId: subOrder.storeId,
          subOrderId: subOrder.id,
          type: LedgerEntryType.refund_adjustment,
          amount: -grossRefund,
          currency: subOrder.currency,
          sourceKey: `${key}:adjustment`,
          description: "Vendor sale reversed for a provider-confirmed refund.",
        },
        update: {},
      });
      await transaction.ledgerEntry.upsert({
        where: { sourceKey: `${key}:commission` },
        create: {
          storeId: subOrder.storeId,
          subOrderId: subOrder.id,
          type: LedgerEntryType.platform_commission,
          amount: commissionRefund,
          currency: subOrder.currency,
          sourceKey: `${key}:commission`,
          description: "Commission reversed proportionally for a provider-confirmed refund.",
        },
        update: {},
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function recordRefundEarningsForReference(reference: string, amount: bigint): Promise<void> {
  const refunds = await prisma.refund.findMany({
    where: {
      amount,
      status: "succeeded",
      payment: { is: { attempts: { some: { reference } } } },
    },
    select: { id: true },
    take: 2,
  });
  if (refunds.length === 1 && refunds[0]) await recordRefundEarnings(refunds[0].id);
}

export async function getVendorEarnings(ownerId: string) {
  const store = await prisma.store.findUnique({ where: { ownerId }, select: { id: true } });
  if (!store) return null;
  const [ledger, reserved] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { storeId: store.id }, _sum: { amount: true } }),
    prisma.payout.aggregate({ where: { storeId: store.id, status: { in: [PayoutStatus.requested, PayoutStatus.approved] } }, _sum: { amount: true } }),
  ]);
  const balance = ledger._sum.amount ?? 0n;
  const reservedAmount = reserved._sum.amount ?? 0n;
  const available = balance - reservedAmount;
  return { balance, reserved: reservedAmount, available: available > 0n ? available : 0n, currency: "NGN" };
}

export async function listVendorLedger(ownerId: string, page: number, limit: number) {
  const store = await prisma.store.findUnique({ where: { ownerId }, select: { id: true } });
  if (!store) return null;
  const where = { storeId: store.id };
  const [items, total] = await Promise.all([
    prisma.ledgerEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.ledgerEntry.count({ where }),
  ]);
  return { items, total };
}

export async function requestPayout(ownerId: string, amount: bigint, idempotencyKey: string, requestHash: string) {
  const store = await prisma.store.findUnique({ where: { ownerId }, select: { id: true } });
  if (!store) return { kind: "no_store" as const };
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${store.id}))`;
    const existing = await transaction.payout.findUnique({ where: { storeId_idempotencyKey: { storeId: store.id, idempotencyKey } }, select: { requestHash: true, ...payoutSelect } });
    if (existing) return existing.requestHash === requestHash
      ? { kind: "existing" as const, payout: existing }
      : { kind: "idempotency_conflict" as const };
    const ledger = await transaction.ledgerEntry.aggregate({ where: { storeId: store.id }, _sum: { amount: true } });
    const reserved = await transaction.payout.aggregate({ where: { storeId: store.id, status: { in: [PayoutStatus.requested, PayoutStatus.approved] } }, _sum: { amount: true } });
    const available = (ledger._sum.amount ?? 0n) - (reserved._sum.amount ?? 0n);
    if (amount > available) return { kind: "insufficient_balance" as const, available };
    const payout = await transaction.payout.create({
      data: { storeId: store.id, requestedById: ownerId, idempotencyKey, requestHash, amount, currency: "NGN" },
      select: payoutSelect,
    });
    return { kind: "created" as const, payout };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listVendorPayouts(ownerId: string, page: number, limit: number) {
  const store = await prisma.store.findUnique({ where: { ownerId }, select: { id: true } });
  if (!store) return null;
  const where = { storeId: store.id };
  const [items, total] = await Promise.all([
    prisma.payout.findMany({ where, select: payoutSelect, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.payout.count({ where }),
  ]);
  return { items, total };
}

export async function listAdminPayouts(page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.payout.findMany({ select: payoutSelect, orderBy: [{ requestedAt: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
    prisma.payout.count(),
  ]);
  return { items, total };
}

export async function transitionPayout(id: string, adminId: string, action: "approve" | "reject" | "paid", value?: string) {
  return withSerializableRetry(() => prisma.$transaction(async (transaction) => {
    const payout = await transaction.payout.findUnique({ where: { id }, select: { id: true, storeId: true, status: true, amount: true } });
    if (!payout) return { kind: "not_found" as const };
    if (action === "approve") {
      if (payout.status !== PayoutStatus.requested) return { kind: "conflict" as const };
      const changed = await transaction.payout.updateMany({ where: { id, status: PayoutStatus.requested }, data: { status: PayoutStatus.approved, approvedById: adminId, approvedAt: new Date() } });
      if (changed.count !== 1) return { kind: "conflict" as const };
    } else if (action === "reject") {
      if (payout.status !== PayoutStatus.requested && payout.status !== PayoutStatus.approved) return { kind: "conflict" as const };
      const changed = await transaction.payout.updateMany({ where: { id, status: payout.status }, data: { status: PayoutStatus.rejected, rejectedById: adminId, rejectedAt: new Date(), rejectionReason: value ?? "Admin rejected payout." } });
      if (changed.count !== 1) return { kind: "conflict" as const };
    } else {
      if (payout.status !== PayoutStatus.approved || !value) return { kind: "conflict" as const };
      const changed = await transaction.payout.updateMany({ where: { id, status: PayoutStatus.approved }, data: { status: PayoutStatus.paid, completedById: adminId, externalReference: value, completedAt: new Date() } });
      if (changed.count !== 1) return { kind: "conflict" as const };
      await transaction.ledgerEntry.create({
        data: {
          storeId: payout.storeId,
          payoutId: payout.id,
          type: LedgerEntryType.payout,
          amount: -payout.amount,
          currency: "NGN",
          sourceKey: `payout:${payout.id}:debit`,
          description: `Manual payout completed; external reference ${value}.`,
        },
      });
    }
    return { kind: "ok" as const, payout: await transaction.payout.findUniqueOrThrow({ where: { id }, select: payoutSelect }) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export function findAdminPayout(id: string) {
  return prisma.payout.findUnique({ where: { id }, select: payoutSelect });
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt >= retries - 1) throw error;
    }
  }
}
