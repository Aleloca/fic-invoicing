import type { FicAccount, Prisma } from "@prisma/client";
import { generateApiKey } from "@/lib/api-key";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { PROJECT_INCLUDE, type ProjectWithCompany } from "@/lib/projects/config";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDb(): Promise<void> {
  await prisma.invoice.deleteMany();
  await prisma.project.deleteMany();
  await prisma.company.deleteMany();
  await prisma.ficAccount.deleteMany();
}

let counter = 0;

type CompanySettings = Omit<Prisma.CompanyUncheckedCreateInput, "accountId" | "ficCompanyId" | "name">;

export interface ProjectSetup extends Partial<CompanySettings> {
  dryRun?: boolean;
  active?: boolean;
  needsReconnect?: boolean;
  /** Project overrides of the company settings. */
  overrides?: Partial<Prisma.ProjectUncheckedCreateInput>;
  /** Reuse this account instead of creating one. */
  account?: FicAccount;
  /** Reuse this company instead of creating one (its settings win over the ones given here). */
  companyId?: string;
}

export async function createAccount(
  tokens: { access?: string; refresh?: string; expiresInMs?: number } = {},
  data: Partial<Prisma.FicAccountCreateInput> = {},
): Promise<FicAccount> {
  counter += 1;
  return prisma.ficAccount.create({
    data: {
      label: `Account ${counter}`,
      accessTokenEnc: encrypt(tokens.access ?? "access-0"),
      refreshTokenEnc: encrypt(tokens.refresh ?? "refresh-0"),
      tokenExpiresAt: new Date(Date.now() + (tokens.expiresInMs ?? 60 * 60 * 1000)),
      connectedAt: new Date(),
      ...data,
    },
  });
}

/**
 * Creates a project on a fully configured, connected company (FORFETTARIO, dry run off unless
 * overridden). Settings given at the top level are the company defaults.
 */
export async function createProject(
  setup: ProjectSetup = {},
  tokens: { access?: string; refresh?: string; expiresInMs?: number } = {},
): Promise<{ project: ProjectWithCompany; apiKey: string }> {
  const {
    dryRun = false,
    active = true,
    needsReconnect,
    overrides = {},
    account: given,
    companyId: givenCompany,
    ...settings
  } = setup;
  const account = given ?? (await createAccount(tokens, needsReconnect ? { needsReconnect } : {}));
  counter += 1;
  const companyId =
    givenCompany ??
    (
      await prisma.company.create({
        data: {
          accountId: account.id,
          ficCompanyId: 1000 + counter,
          name: `Company ${counter}`,
          vatTypeId: 10,
          paymentAccountId: 20,
          paymentMethodId: 30,
          stampDutyVatTypeId: 40,
          numeration: "/T",
          itemCode: "ITEM",
          ...settings,
        },
      })
    ).id;
  const key = generateApiKey();
  const project = await prisma.project.create({
    data: {
      name: `Project ${counter}`,
      slug: `project-${counter}-${Date.now()}`,
      apiKeyHash: key.hash,
      apiKeyPrefix: key.displayPrefix,
      dryRun,
      active,
      companyId,
      ...overrides,
    },
    include: PROJECT_INCLUDE,
  });
  return { project, apiKey: key.plaintext };
}
