-- CreateEnum
CREATE TYPE "stock_reservation_status" AS ENUM ('active', 'released', 'expired');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "stock_reservation_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_variant_id_key" ON "inventory_items"("variant_id");

-- CreateIndex
CREATE INDEX "inventory_items_quantity_on_hand_low_stock_threshold_idx" ON "inventory_items"("quantity_on_hand", "low_stock_threshold");

-- CreateIndex
CREATE INDEX "stock_reservations_inventory_id_status_expires_at_idx" ON "stock_reservations"("inventory_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_user_id_status_expires_at_idx" ON "stock_reservations"("user_id", "status", "expires_at");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill inventory records for variants created before Phase 5.
INSERT INTO "inventory_items" ("id", "variant_id", "quantity_on_hand", "low_stock_threshold", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 0, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "product_variants";

-- Protect invariants even if future write paths bypass request validation.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_quantity_on_hand_nonnegative_check" CHECK ("quantity_on_hand" >= 0),
  ADD CONSTRAINT "inventory_items_low_stock_threshold_nonnegative_check" CHECK ("low_stock_threshold" >= 0);

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_positive_check" CHECK ("quantity" > 0);
