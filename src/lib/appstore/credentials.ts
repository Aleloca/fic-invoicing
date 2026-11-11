import type { AppleAccount } from "@prisma/client";
import { decrypt } from "../crypto";
import type { AppStoreCredentials } from "./client";

export function credentialsOf(account: AppleAccount): AppStoreCredentials {
  return {
    issuerId: account.issuerId,
    keyId: account.keyId,
    privateKey: decrypt(account.privateKeyEnc),
    vendorNumber: account.vendorNumber,
  };
}
