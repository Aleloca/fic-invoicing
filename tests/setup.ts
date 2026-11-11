import { randomBytes } from "node:crypto";

// Deterministic, fake configuration. FIC is never called for real: every test
// that reaches the network stubs `fetch` (see helpers/fic-mock.ts).
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.FIC_CLIENT_ID = "test-client-id";
process.env.FIC_CLIENT_SECRET = "test-client-secret";
process.env.PUBLIC_BASE_URL = "http://localhost:3000";
process.env.FIC_API_BASE_URL = "https://fic.test";
process.env.RATE_LIMIT_PER_MINUTE = "1000";

// Integration tests run only against an explicit test database, never DATABASE_URL from .env.
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  if (!/test/i.test(new URL(testUrl).pathname)) {
    throw new Error("TEST_DATABASE_URL must point to a database whose name contains 'test' (it is wiped by the tests)");
  }
  process.env.DATABASE_URL = testUrl;
}
