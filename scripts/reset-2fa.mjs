// Emergency unlock: turns off two-factor sign-in of the admin panel and signs out every session.
// The password alone opens the panel again; set up the second factor anew from the Security page.
// Usage (needs DATABASE_URL in the environment): node scripts/reset-2fa.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const { count } = await prisma.adminPasskey.deleteMany();
  await prisma.adminSecurity.upsert({
    where: { id: 1 },
    create: { id: 1, sessionVersion: 2 },
    update: { totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null, recoveryCodes: [], sessionVersion: { increment: 1 } },
  });
  console.log(`Two-factor sign-in turned off (${count} passkey(s) and the authenticator app removed). Every session is signed out.`);
} finally {
  await prisma.$disconnect();
}
