-- Replace the boolean `applyStampDuty` with the `stampDutyMode` enum.
-- AlterTable: add the new column with its default.
ALTER TABLE `tenants` ADD COLUMN `stampDutyMode` ENUM('CHARGED_TO_CUSTOMER', 'INCLUDED', 'DISABLED') NOT NULL DEFAULT 'CHARGED_TO_CUSTOMER';

-- Convert existing rows: true -> CHARGED_TO_CUSTOMER (previous behaviour), false -> DISABLED.
UPDATE `tenants` SET `stampDutyMode` = IF(`applyStampDuty`, 'CHARGED_TO_CUSTOMER', 'DISABLED');

-- AlterTable: drop the old column.
ALTER TABLE `tenants` DROP COLUMN `applyStampDuty`;
