-- CreateTable
CREATE TABLE `admin_security` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `totpSecretEnc` TEXT NULL,
    `totpPendingEnc` TEXT NULL,
    `totpLastStep` INTEGER NULL,
    `recoveryCodes` JSON NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_passkeys` (
    `id` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(512) NOT NULL,
    `publicKey` BLOB NOT NULL,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `transports` JSON NULL,
    `name` VARCHAR(191) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_passkeys_credentialId_key`(`credentialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

