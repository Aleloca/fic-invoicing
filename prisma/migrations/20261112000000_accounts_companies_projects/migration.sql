-- Split tenants into Fatture in Cloud accounts (tokens), companies (default invoice settings)
-- and projects (the apps, renamed from tenants). Data is preserved: nobody has to reconnect.
-- Project ids are the old tenant ids, so invoice rows keep pointing at the same app; each invoice
-- records the company of its project.

-- CreateTable
CREATE TABLE `fic_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `ficUserId` INTEGER NULL,
    `ficUserEmail` VARCHAR(191) NULL,
    `accessTokenEnc` TEXT NULL,
    `refreshTokenEnc` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `needsReconnect` BOOLEAN NOT NULL DEFAULT false,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fic_accounts_ficUserId_key`(`ficUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `ficCompanyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `fiscalRegime` ENUM('FORFETTARIO', 'ORDINARIO') NOT NULL DEFAULT 'FORFETTARIO',
    `vatTypeId` INTEGER NULL,
    `nonTaxableVatTypeId` INTEGER NULL,
    `paymentAccountId` INTEGER NULL,
    `paymentMethodId` INTEGER NULL,
    `numeration` VARCHAR(191) NULL,
    `itemCode` VARCHAR(191) NULL,
    `fiscalStatements` JSON NULL,
    `eiPaymentMethod` VARCHAR(191) NOT NULL DEFAULT 'MP08',
    `stampDutyMode` ENUM('CHARGED_TO_CUSTOMER', 'INCLUDED', 'DISABLED') NOT NULL DEFAULT 'CHARGED_TO_CUSTOMER',
    `stampDutyVatTypeId` INTEGER NULL,
    `sendToSdi` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_accountId_ficCompanyId_key`(`accountId`, `ficCompanyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `apiKeyHash` CHAR(64) NOT NULL,
    `apiKeyPrefix` VARCHAR(191) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `dryRun` BOOLEAN NOT NULL DEFAULT true,
    `companyId` VARCHAR(191) NULL,
    `vatTypeId` INTEGER NULL,
    `nonTaxableVatTypeId` INTEGER NULL,
    `paymentAccountId` INTEGER NULL,
    `paymentMethodId` INTEGER NULL,
    `numeration` VARCHAR(191) NULL,
    `itemCode` VARCHAR(191) NULL,
    `fiscalStatements` JSON NULL,
    `eiPaymentMethod` VARCHAR(191) NULL,
    `stampDutyMode` ENUM('CHARGED_TO_CUSTOMER', 'INCLUDED', 'DISABLED') NULL,
    `stampDutyVatTypeId` INTEGER NULL,
    `sendToSdi` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `projects_slug_key`(`slug`),
    UNIQUE INDEX `projects_apiKeyHash_key`(`apiKeyHash`),
    INDEX `projects_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tenants on the same FIC company become projects of one company. Its "primary" tenant gives the
-- account tokens and the default settings: the one still authorized and most recently connected.
CREATE TABLE `_tenant_primary` (
    `ficCompanyId` INTEGER NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    PRIMARY KEY (`ficCompanyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_tenant_primary` (`ficCompanyId`, `tenantId`)
SELECT g.`ficCompanyId`,
    (SELECT t2.`id` FROM `tenants` t2
     WHERE t2.`ficCompanyId` = g.`ficCompanyId` AND t2.`refreshTokenEnc` IS NOT NULL
     ORDER BY t2.`ficNeedsReconnect` ASC, t2.`connectedAt` DESC, t2.`id` ASC
     LIMIT 1)
FROM (SELECT DISTINCT `ficCompanyId` FROM `tenants` WHERE `ficCompanyId` IS NOT NULL AND `refreshTokenEnc` IS NOT NULL) g;

-- One account per primary tenant, and per tenant that authorized without choosing a company.
INSERT INTO `fic_accounts` (`id`, `label`, `accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`, `connectedAt`,
    `needsReconnect`, `lastError`, `createdAt`, `updatedAt`)
SELECT CONCAT('acc_', t.`id`), COALESCE(t.`ficCompanyName`, t.`name`), t.`accessTokenEnc`, t.`refreshTokenEnc`, t.`tokenExpiresAt`,
    t.`connectedAt`, t.`ficNeedsReconnect`, t.`ficLastError`, t.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `tenants` t
WHERE t.`refreshTokenEnc` IS NOT NULL
  AND (t.`ficCompanyId` IS NULL OR t.`id` IN (SELECT `tenantId` FROM `_tenant_primary`));

-- One company per FIC company, with the primary tenant's settings as defaults.
INSERT INTO `companies` (`id`, `accountId`, `ficCompanyId`, `name`, `fiscalRegime`, `vatTypeId`, `nonTaxableVatTypeId`,
    `paymentAccountId`, `paymentMethodId`, `numeration`, `itemCode`, `fiscalStatements`, `eiPaymentMethod`,
    `stampDutyMode`, `stampDutyVatTypeId`, `sendToSdi`, `createdAt`, `updatedAt`)
SELECT CONCAT('co_', t.`id`), CONCAT('acc_', t.`id`), t.`ficCompanyId`, COALESCE(t.`ficCompanyName`, CONCAT('Company #', t.`ficCompanyId`)),
    t.`fiscalRegime`, t.`vatTypeId`, t.`nonTaxableVatTypeId`, t.`paymentAccountId`, t.`paymentMethodId`, t.`numeration`, t.`itemCode`,
    t.`fiscalStatements`, t.`eiPaymentMethod`, t.`stampDutyMode`, t.`stampDutyVatTypeId`, t.`sendToSdi`, t.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `tenants` t
JOIN `_tenant_primary` tp ON tp.`tenantId` = t.`id`;

-- Projects. With a company: overrides only where the tenant differed from the company defaults
-- (none for the primary tenant). Without one: non-default values are kept as overrides, applied
-- once a company is chosen.
INSERT INTO `projects` (`id`, `name`, `slug`, `apiKeyHash`, `apiKeyPrefix`, `active`, `dryRun`, `companyId`,
    `vatTypeId`, `nonTaxableVatTypeId`, `paymentAccountId`, `paymentMethodId`, `numeration`, `itemCode`,
    `fiscalStatements`, `eiPaymentMethod`, `stampDutyMode`, `stampDutyVatTypeId`, `sendToSdi`, `createdAt`, `updatedAt`)
SELECT t.`id`, t.`name`, t.`slug`, t.`apiKeyHash`, t.`apiKeyPrefix`, t.`active`, t.`dryRun`, c.`id`,
    IF(c.`id` IS NULL, t.`vatTypeId`, IF(t.`vatTypeId` <=> c.`vatTypeId`, NULL, t.`vatTypeId`)),
    IF(c.`id` IS NULL, t.`nonTaxableVatTypeId`, IF(t.`nonTaxableVatTypeId` <=> c.`nonTaxableVatTypeId`, NULL, t.`nonTaxableVatTypeId`)),
    IF(c.`id` IS NULL, t.`paymentAccountId`, IF(t.`paymentAccountId` <=> c.`paymentAccountId`, NULL, t.`paymentAccountId`)),
    IF(c.`id` IS NULL, t.`paymentMethodId`, IF(t.`paymentMethodId` <=> c.`paymentMethodId`, NULL, t.`paymentMethodId`)),
    IF(c.`id` IS NULL, t.`numeration`, IF(t.`numeration` <=> c.`numeration`, NULL, COALESCE(t.`numeration`, ''))),
    IF(c.`id` IS NULL, t.`itemCode`, IF(t.`itemCode` <=> c.`itemCode`, NULL, COALESCE(t.`itemCode`, ''))),
    IF(c.`id` IS NULL, t.`fiscalStatements`, IF(t.`fiscalStatements` <=> c.`fiscalStatements`, NULL, t.`fiscalStatements`)),
    IF(c.`id` IS NULL, IF(t.`eiPaymentMethod` <> 'MP08', t.`eiPaymentMethod`, NULL), IF(t.`eiPaymentMethod` <=> c.`eiPaymentMethod`, NULL, t.`eiPaymentMethod`)),
    IF(c.`id` IS NULL, IF(t.`stampDutyMode` <> 'CHARGED_TO_CUSTOMER', t.`stampDutyMode`, NULL), IF(t.`stampDutyMode` <=> c.`stampDutyMode`, NULL, t.`stampDutyMode`)),
    IF(c.`id` IS NULL, t.`stampDutyVatTypeId`, IF(t.`stampDutyVatTypeId` <=> c.`stampDutyVatTypeId`, NULL, t.`stampDutyVatTypeId`)),
    IF(c.`id` IS NULL, IF(t.`sendToSdi`, TRUE, NULL), IF(t.`sendToSdi` <=> c.`sendToSdi`, NULL, t.`sendToSdi`)),
    t.`createdAt`, t.`updatedAt`
FROM `tenants` t
LEFT JOIN `_tenant_primary` tp ON tp.`ficCompanyId` = t.`ficCompanyId` AND t.`refreshTokenEnc` IS NOT NULL
LEFT JOIN `companies` c ON c.`id` = CONCAT('co_', tp.`tenantId`);

DROP TABLE `_tenant_primary`;

-- Invoices: tenantId -> projectId, and record the company that issued them.
ALTER TABLE `invoices` DROP FOREIGN KEY `invoices_tenantId_fkey`;
DROP INDEX `invoices_tenantId_idempotencyKey_key` ON `invoices`;
DROP INDEX `invoices_tenantId_status_createdAt_idx` ON `invoices`;
ALTER TABLE `invoices` RENAME COLUMN `tenantId` TO `projectId`,
    ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `invoices` i JOIN `projects` p ON p.`id` = i.`projectId` SET i.`companyId` = p.`companyId`;

-- DropTable
DROP TABLE `tenants`;

-- CreateIndex
CREATE INDEX `invoices_projectId_status_createdAt_idx` ON `invoices`(`projectId`, `status`, `createdAt`);
CREATE INDEX `invoices_companyId_idx` ON `invoices`(`companyId`);
CREATE UNIQUE INDEX `invoices_projectId_idempotencyKey_key` ON `invoices`(`projectId`, `idempotencyKey`);

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `fic_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `projects` ADD CONSTRAINT `projects_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
