-- CreateTable
CREATE TABLE `tenants` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `apiKeyHash` CHAR(64) NOT NULL,
    `apiKeyPrefix` VARCHAR(191) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `ficCompanyId` INTEGER NULL,
    `ficCompanyName` VARCHAR(191) NULL,
    `accessTokenEnc` TEXT NULL,
    `refreshTokenEnc` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `ficNeedsReconnect` BOOLEAN NOT NULL DEFAULT false,
    `ficLastError` TEXT NULL,
    `vatTypeId` INTEGER NULL,
    `nonTaxableVatTypeId` INTEGER NULL,
    `paymentAccountId` INTEGER NULL,
    `paymentMethodId` INTEGER NULL,
    `numeration` VARCHAR(191) NULL,
    `itemCode` VARCHAR(191) NULL,
    `fiscalRegime` ENUM('FORFETTARIO', 'ORDINARIO') NOT NULL DEFAULT 'FORFETTARIO',
    `fiscalStatements` JSON NULL,
    `eiPaymentMethod` VARCHAR(191) NOT NULL DEFAULT 'MP08',
    `applyStampDuty` BOOLEAN NOT NULL DEFAULT true,
    `sendToSdi` BOOLEAN NOT NULL DEFAULT false,
    `dryRun` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    UNIQUE INDEX `tenants_apiKeyHash_key`(`apiKeyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `externalRef` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ISSUED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `customerCategory` ENUM('IT_PRIVATE', 'EU_PRIVATE', 'EXTRAEU_PRIVATE', 'IT_BUSINESS') NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `stampDutyCents` INTEGER NOT NULL DEFAULT 0,
    `description` TEXT NOT NULL,
    `ficDocumentId` INTEGER NULL,
    `ficNumber` VARCHAR(191) NULL,
    `dryRun` BOOLEAN NOT NULL,
    `errorMessage` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `requestPayload` JSON NULL,
    `sdiSentAt` DATETIME(3) NULL,
    `sdiError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `invoices_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `invoices_tenantId_idempotencyKey_key`(`tenantId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

