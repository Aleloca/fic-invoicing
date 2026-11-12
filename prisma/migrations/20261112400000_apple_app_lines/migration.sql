-- Each Apple app can set the name and description of its invoice line.
-- AlterTable
ALTER TABLE `apple_apps` ADD COLUMN `invoiceDescription` TEXT NULL,
    ADD COLUMN `invoiceItemName` VARCHAR(191) NULL;
