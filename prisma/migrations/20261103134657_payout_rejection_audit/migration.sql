-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "rejected_by_id" UUID;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
