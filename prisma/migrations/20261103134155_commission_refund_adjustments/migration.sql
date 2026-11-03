/*
  Warnings:

  - Added the required column `request_hash` to the `payouts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "ledger_entry_type" ADD VALUE 'refund_adjustment';

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "request_hash" CHAR(64) NOT NULL;
