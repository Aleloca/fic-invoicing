-- Invoices deleted from Fatture in Cloud by an admin keep their row (status DELETED) for audit.
-- AlterTable
ALTER TABLE `invoices` MODIFY `status` ENUM('PENDING', 'ISSUED', 'FAILED', 'DELETED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `deletedAt` DATETIME(3) NULL;
