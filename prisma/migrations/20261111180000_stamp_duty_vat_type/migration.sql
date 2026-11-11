-- VAT type (excluded under art. 15 DPR 633/72) of the "Rimborso imposta di bollo" invoice line,
-- required when stampDutyMode is CHARGED_TO_CUSTOMER.
-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `stampDutyVatTypeId` INTEGER NULL;
