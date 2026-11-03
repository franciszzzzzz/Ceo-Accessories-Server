-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "category_ids" UUID[] DEFAULT ARRAY[]::UUID[];
