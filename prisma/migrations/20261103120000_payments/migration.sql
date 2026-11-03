-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed', 'partially_refunded', 'refunded', 'needs_attention');

-- CreateEnum
CREATE TYPE "payment_attempt_status" AS ENUM ('initializing', 'pending', 'succeeded', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'needs_attention');

-- CreateEnum
CREATE TYPE "payment_webhook_event_status" AS ENUM ('processed', 'ignored', 'attention');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'paystack',
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "reference" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "provider_transaction_id" VARCHAR(64),
    "authorization_url" VARCHAR(2048),
    "status" "payment_attempt_status" NOT NULL DEFAULT 'initializing',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(200) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "reference" VARCHAR(128),
    "payload_hash" CHAR(64) NOT NULL,
    "status" "payment_webhook_event_status" NOT NULL DEFAULT 'processed',
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "initiated_by_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "provider_refund_id" VARCHAR(64),
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "refund_status" NOT NULL DEFAULT 'pending',
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_reference_key" ON "payment_attempts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_transaction_id_key" ON "payment_attempts"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_status_expires_at_idx" ON "payment_attempts"("payment_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_payment_id_idempotency_key_key" ON "payment_attempts"("payment_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_event_key_key" ON "payment_webhook_events"("event_key");

-- CreateIndex
CREATE INDEX "payment_webhook_events_reference_created_at_idx" ON "payment_webhook_events"("reference", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_status_created_at_idx" ON "refunds"("payment_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_idempotency_key_key" ON "refunds"("payment_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_currency_ngn_check" CHECK ("currency" = 'NGN');

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "refunds_currency_ngn_check" CHECK ("currency" = 'NGN');
