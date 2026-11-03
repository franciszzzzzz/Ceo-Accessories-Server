-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_payment', 'paid', 'cancelled', 'payment_failed', 'completed');

-- CreateEnum
CREATE TYPE "sub_order_status" AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded');

-- AlterEnum
ALTER TYPE "stock_reservation_status" ADD VALUE 'converted';

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending_payment',
    "total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "shipping_address" JSONB NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "status" "sub_order_status" NOT NULL DEFAULT 'pending',
    "total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "store_name" VARCHAR(120) NOT NULL,
    "store_slug" VARCHAR(140) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" VARCHAR(180) NOT NULL,
    "product_slug" VARCHAR(180) NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "options" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "line_total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sub_orders_store_id_status_created_at_idx" ON "sub_orders"("store_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sub_orders_order_id_store_id_key" ON "sub_orders"("order_id", "store_id");

-- CreateIndex
CREATE INDEX "order_items_sub_order_id_idx" ON "order_items"("sub_order_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_amount_nonnegative_check" CHECK ("total_amount" >= 0),
  ADD CONSTRAINT "orders_shipping_address_object_check" CHECK (jsonb_typeof("shipping_address") = 'object');

ALTER TABLE "sub_orders"
  ADD CONSTRAINT "sub_orders_total_amount_nonnegative_check" CHECK ("total_amount" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_unit_price_nonnegative_check" CHECK ("unit_price_amount" >= 0),
  ADD CONSTRAINT "order_items_line_total_nonnegative_check" CHECK ("line_total_amount" >= 0),
  ADD CONSTRAINT "order_items_line_total_consistent_check" CHECK ("line_total_amount" = "unit_price_amount"::bigint * "quantity"::bigint);
