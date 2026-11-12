import { headers } from "next/headers";

/**
 * The client address for rate limiting. Proxies append the address they saw to X-Forwarded-For,
 * so the last entry is the one set by our proxy; the earlier ones come from the client and can be
 * anything. Without a proxy there is no header and every request shares one bucket.
 */
export async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || "local";
}
