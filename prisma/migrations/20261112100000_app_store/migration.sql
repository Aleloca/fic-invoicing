-- App Store payouts: Apple accounts of projects, their financial reports, and EU business customers.
-- AlterTable
ALTER TABLE `invoices` MODIFY `customerCategory` ENUM('IT_PRIVATE', 'EU_PRIVATE', 'EXTRAEU_PRIVATE', 'IT_BUSINESS', 'EU_BUSINESS') NOT NULL;

-- CreateTable
CREATE TABLE `app_store_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `issuerId` VARCHAR(191) NOT NULL,
    `keyId` VARCHAR(191) NOT NULL,
    `privateKeyEnc` TEXT NOT NULL,
    `vendorNumber` VARCHAR(191) NOT NULL,
    `appName` VARCHAR(191) NOT NULL,
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

    UNIQUE INDEX `app_store_accounts_projectId_key`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_store_reports` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `lines` JSON NOT NULL,
    `ecbRates` JSON NULL,
    `estimatedCents` INTEGER NULL,
    `status` ENUM('READY', 'INVOICED', 'DISMISSED') NOT NULL DEFAULT 'READY',
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `invoiceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `app_store_reports_invoiceId_key`(`invoiceId`),
    UNIQUE INDEX `app_store_reports_accountId_period_key`(`accountId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `app_store_accounts` ADD CONSTRAINT `app_store_accounts_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_store_reports` ADD CONSTRAINT `app_store_reports_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `app_store_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_store_reports` ADD CONSTRAINT `app_store_reports_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

