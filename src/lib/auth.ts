import { hashApiKey } from "./api-key";
import { env } from "./env";
import { ApiError } from "./errors";
import { prisma } from "./prisma";
import { PROJECT_INCLUDE, type ProjectWithCompany } from "./projects/config";
import { RateLimiter } from "./rate-limit";

let limiter: RateLimiter | null = null;

export function apiRateLimiter(): RateLimiter {
  limiter ??= new RateLimiter(env.rateLimitPerMinute());
  return limiter;
}

/** Authenticates a public API request with `Authorization: Bearer <api key>`. */
export async function authenticateProject(request: Request): Promise<ProjectWithCompany> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    throw new ApiError(401, "unauthorized", "Missing or malformed Authorization header (expected: Bearer <api key>)");
  }

  const keyHash = hashApiKey(match[1]);
  const retryAfter = apiRateLimiter().hit(keyHash);
  if (retryAfter > 0) {
    throw new ApiError(429, "rate_limited", `Too many requests, retry in ${retryAfter}s`, { retryAfterSeconds: retryAfter });
  }

  const project = await prisma.project.findUnique({ where: { apiKeyHash: keyHash }, include: PROJECT_INCLUDE });
  if (!project) throw new ApiError(401, "unauthorized", "Invalid API key");
  if (!project.active) throw new ApiError(403, "forbidden", "This project is disabled");
  return project;
}
