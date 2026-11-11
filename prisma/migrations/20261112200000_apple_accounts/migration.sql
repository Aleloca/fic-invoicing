-- Apple developer accounts are no longer tied to one project: one account can sell the apps of several
-- projects. Products seen in the reports are assigned to projects; invoices to Apple belong to the account.

-- CreateTable
CREATE TABLE `apple_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `issuerId` VARCHAR(191) NOT NULL,
    `keyId` VARCHAR(191) NOT NULL,
    `privateKeyEnc` TEXT NOT NULL,
    `vendorNumber` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `dryRun` BOOLEAN NOT NULL DEFAULT true,
    `customer` JSON NOT NULL,
    `itemName` VARCHAR(191) NOT NULL DEFAULT 'Distribuzione applicazioni mobili',
    `vatTypeId` INTEGER NULL,
    `paymentAccountId` INTEGER NULL,
    `paymentMethodId` INTEGER NULL,
    `eiPaymentMethod` VARCHAR(191) NOT NULL DEFAULT 'MP05',
    `statement` TEXT NULL,
    `nextPeriod` VARCHAR(191) NOT NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apple_products` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `appleId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `apple_products_projectId_idx`(`projectId`),
    UNIQUE INDEX `apple_products_accountId_appleId_key`(`accountId`, `appleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Each project-level App Store configuration becomes an Apple account (same id, so its reports keep
-- pointing at it), issuing from the project's company with the project's dry run. Reports not invoiced
-- yet are downloaded again with product details: the next period moves back to the first of them.
INSERT INTO `apple_accounts` (`id`, `label`, `issuerId`, `keyId`, `privateKeyEnc`, `vendorNumber`, `companyId`, `dryRun`,
    `customer`, `itemName`, `vatTypeId`, `paymentAccountId`, `paymentMethodId`, `eiPaymentMethod`, `statement`,
    `nextPeriod`, `lastCheckedAt`, `lastError`, `createdAt`, `updatedAt`)
SELECT a.`id`, CONCAT('Apple vendor ', a.`vendorNumber`), a.`issuerId`, a.`keyId`, a.`privateKeyEnc`, a.`vendorNumber`,
    p.`companyId`, p.`dryRun`, a.`customer`, a.`itemName`, a.`vatTypeId`, a.`paymentAccountId`, a.`paymentMethodId`,
    a.`eiPaymentMethod`, a.`statement`,
    LEAST(a.`nextPeriod`, COALESCE((SELECT MIN(r.`period`) FROM `app_store_reports` r
        WHERE r.`accountId` = a.`id` AND r.`status` = 'READY' AND r.`invoiceId` IS NULL), a.`nextPeriod`)),
    a.`lastCheckedAt`, a.`lastError`, a.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `app_store_accounts` a
JOIN `projects` p ON p.`id` = a.`projectId`;

DELETE FROM `app_store_reports` WHERE `status` = 'READY' AND `invoiceId` IS NULL;

-- Reports now belong to Apple accounts.
ALTER TABLE `app_store_reports` DROP FOREIGN KEY `app_store_reports_accountId_fkey`;
ALTER TABLE `app_store_accounts` DROP FOREIGN KEY `app_store_accounts_projectId_fkey`;
DROP TABLE `app_store_accounts`;

-- Invoices to Apple belong to an Apple account instead of a project.
ALTER TABLE `invoices` ADD COLUMN `appleAccountId` VARCHAR(191) NULL,
    MODIFY `projectId` VARCHAR(191) NULL;
CREATE INDEX `invoices_appleAccountId_idx` ON `invoices`(`appleAccountId`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_appleAccountId_fkey` FOREIGN KEY (`appleAccountId`) REFERENCES `apple_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `apple_accounts` ADD CONSTRAINT `apple_accounts_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `apple_products` ADD CONSTRAINT `apple_products_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `apple_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `apple_products` ADD CONSTRAINT `apple_products_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `app_store_reports` ADD CONSTRAINT `app_store_reports_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `apple_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
