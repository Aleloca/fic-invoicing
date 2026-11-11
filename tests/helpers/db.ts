import type { Prisma, Tenant } from "@prisma/client";
import { generateApiKey } from "@/lib/api-key";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDb(): Promise<void> {
  await prisma.invoice.deleteMany();
  await prisma.tenant.deleteMany();
}

let counter = 0;

/** Creates a fully configured, connected tenant (FORFETTARIO, dry run off unless overridden). */
export async function createTenant(
  overrides: Partial<Prisma.TenantCreateInput> = {},
  tokens: { access?: string; refresh?: string; expiresInMs?: number } = {},
): Promise<{ tenant: Tenant; apiKey: string }> {
  counter += 1;
  const key = generateApiKey();
  const tenant = await prisma.tenant.create({
    data: {
      name: `Tenant ${counter}`,
      slug: `tenant-${counter}-${Date.now()}`,
      apiKeyHash: key.hash,
      apiKeyPrefix: key.displayPrefix,
      ficCompanyId: 1000 + counter,
      ficCompanyName: `Company ${counter}`,
      accessTokenEnc: encrypt(tokens.access ?? "access-0"),
      refreshTokenEnc: encrypt(tokens.refresh ?? "refresh-0"),
      tokenExpiresAt: new Date(Date.now() + (tokens.expiresInMs ?? 60 * 60 * 1000)),
      connectedAt: new Date(),
      vatTypeId: 10,
      paymentAccountId: 20,
      paymentMethodId: 30,
      stampDutyVatTypeId: 40,
      numeration: "/T",
      itemCode: "ITEM",
      dryRun: false,
      ...overrides,
    },
  });
  return { tenant, apiKey: key.plaintext };
}
