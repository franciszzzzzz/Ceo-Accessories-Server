-- CreateEnum
CREATE TYPE "vendor_application_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "store_status" AS ENUM ('pending', 'active', 'suspended');

-- CreateTable
CREATE TABLE "vendor_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "open_user_id" UUID,
    "status" "vendor_application_status" NOT NULL DEFAULT 'pending',
    "business_name" VARCHAR(160) NOT NULL,
    "store_name" VARCHAR(120) NOT NULL,
    "business_description" VARCHAR(1000),
    "contact_phone" VARCHAR(16) NOT NULL,
    "rejection_reason" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" VARCHAR(1000),
    "contact_phone" VARCHAR(16) NOT NULL,
    "status" "store_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_applications_open_user_id_key" ON "vendor_applications"("open_user_id");

-- CreateIndex
CREATE INDEX "vendor_applications_user_id_created_at_idx" ON "vendor_applications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_applications_status_created_at_idx" ON "vendor_applications"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stores_owner_id_key" ON "stores"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE INDEX "stores_status_created_at_idx" ON "stores"("status", "created_at");

-- AddForeignKey
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
