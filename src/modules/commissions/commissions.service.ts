import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import type { CommissionRuleInput } from "./commissions.schemas.js";
import * as repository from "./commissions.repository.js";

export async function createRule(adminId: string, input: CommissionRuleInput) {
  const now = new Date();
  if (input.effectiveFrom && new Date(input.effectiveFrom) < now) {
    throw new AppError(422, "UNPROCESSABLE", "Commission rules cannot be backdated.");
  }
  if (input.effectiveUntil && new Date(input.effectiveUntil) <= now) {
    throw new AppError(422, "UNPROCESSABLE", "Commission rules must end in the future.");
  }
  try {
    return { rule: await repository.createCommissionRule(adminId, input) };
  } catch (error) {
    if (error instanceof repository.CommissionRuleConflict) throw new AppError(409, "CONFLICT", "A commission rule already covers this scope and effective period.");
    throw error;
  }
}

export async function listRules(page: number, limit: number) {
  const result = await repository.listCommissionRules(page, limit);
  return { rules: result.items, total: result.total };
}

export async function endRule(id: string, effectiveUntil: string) {
  const result = await repository.endCommissionRule(id, new Date(effectiveUntil));
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Commission rule not found.");
  if (result.kind === "conflict") throw new AppError(409, "CONFLICT", "Commission rule cannot be ended at that time or is already ended.");
  return { rule: result.rule };
}

export async function recordOrderEarnings(orderId: string) {
  await repository.recordOrderEarnings(orderId);
}

export async function recordEarningsForReference(reference: string) {
  await repository.recordEarningsForReference(reference);
}

export async function recordRefundEarnings(refundId: string) {
  await repository.recordRefundEarnings(refundId);
}

export async function recordRefundEarningsForReference(reference: string, amount: bigint) {
  await repository.recordRefundEarningsForReference(reference, amount);
}

export async function getEarnings(ownerId: string) {
  const result = await repository.getVendorEarnings(ownerId);
  if (!result) throw new AppError(404, "NOT_FOUND", "Store not found.");
  return {
    earnings: {
      balance: money(result.balance),
      reservedForPayout: money(result.reserved),
      available: money(result.available),
    },
  };
}

export async function listLedger(ownerId: string, page: number, limit: number) {
  const result = await repository.listVendorLedger(ownerId, page, limit);
  if (!result) throw new AppError(404, "NOT_FOUND", "Store not found.");
  return { entries: result.items.map((item) => ({
    id: item.id,
    type: item.type,
    amount: money(item.amount),
    description: item.description,
    subOrderId: item.subOrderId,
    payoutId: item.payoutId,
    createdAt: item.createdAt,
  })), total: result.total };
}

export async function requestPayout(ownerId: string, amount: number, idempotencyKey: string) {
  const requestHash = createHash("sha256").update(JSON.stringify({ amount })).digest("hex");
  const result = await repository.requestPayout(ownerId, BigInt(amount), idempotencyKey, requestHash);
  if (result.kind === "no_store") throw new AppError(404, "NOT_FOUND", "Store not found.");
  if (result.kind === "idempotency_conflict") throw new AppError(409, "CONFLICT", "This Idempotency-Key was already used for a different payout request.");
  if (result.kind === "insufficient_balance") throw new AppError(422, "UNPROCESSABLE", "Payout amount exceeds the available balance.", { availableAmount: safeAmount(result.available) });
  return { payout: serializePayout(result.payout) };
}

export async function listVendorPayouts(ownerId: string, page: number, limit: number) {
  const result = await repository.listVendorPayouts(ownerId, page, limit);
  if (!result) throw new AppError(404, "NOT_FOUND", "Store not found.");
  return { payouts: result.items.map(serializePayout), total: result.total };
}

export async function listAdminPayouts(page: number, limit: number) {
  const result = await repository.listAdminPayouts(page, limit);
  return { payouts: result.items.map(serializePayout), total: result.total };
}

export async function transitionPayout(id: string, adminId: string, action: "approve" | "reject" | "paid", value?: string) {
  const result = await repository.transitionPayout(id, adminId, action, value);
  if (result.kind === "not_found") throw new AppError(404, "NOT_FOUND", "Payout not found.");
  if (result.kind === "conflict") throw new AppError(409, "CONFLICT", "Payout state does not allow this transition.");
  return { payout: serializePayout(result.payout) };
}

function serializePayout(payout: {
  id: string;
  amount: bigint;
  currency: string;
  status: string;
  externalReference: string | null;
  rejectionReason: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  completedAt: Date | null;
  store: { id: string; name: string; slug: string; ownerId: string };
}) {
  return {
    id: payout.id,
    amount: money(payout.amount),
    status: payout.status,
    externalReference: payout.externalReference,
    rejectionReason: payout.rejectionReason,
    requestedAt: payout.requestedAt,
    approvedAt: payout.approvedAt,
    rejectedAt: payout.rejectedAt,
    completedAt: payout.completedAt,
    store: { id: payout.store.id, name: payout.store.name, slug: payout.store.slug },
  };
}

function money(amount: bigint) {
  return { amount: safeAmount(amount), currency: "NGN" };
}

function safeAmount(amount: bigint): number {
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) throw new AppError(500, "INTERNAL_ERROR", "Stored financial amount exceeds the supported API range.");
  return value;
}
