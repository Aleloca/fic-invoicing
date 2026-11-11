-- Apple apps: products belong to the project of their app (paid app or parent of an in-app purchase).
-- AlterTable
ALTER TABLE `apple_products` ADD COLUMN `appId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `apple_apps` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `appleId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `apple_apps_projectId_idx`(`projectId`),
    UNIQUE INDEX `apple_apps_accountId_appleId_key`(`accountId`, `appleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `apple_products_appId_idx` ON `apple_products`(`appId`);

-- AddForeignKey
ALTER TABLE `apple_apps` ADD CONSTRAINT `apple_apps_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `apple_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `apple_apps` ADD CONSTRAINT `apple_apps_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `apple_products` ADD CONSTRAINT `apple_products_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `apple_apps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

