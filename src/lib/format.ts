import type { CustomerCategory } from "@prisma/client";

const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

export function euros(cents: number): string {
  return EUR.format(cents / 100);
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Rome",
});

/** Date and time in Italian local time, the time the invoices are dated in. */
export function dateTime(date: Date): string {
  return DATE_TIME.format(date);
}

export function dateOnly(date: Date): string {
  return DATE.format(date);
}

export const CATEGORY_LABELS: Record<CustomerCategory, string> = {
  IT_PRIVATE: "Private, Italy",
  EU_PRIVATE: "Private, EU",
  EXTRAEU_PRIVATE: "Private, outside EU",
  IT_BUSINESS: "Business, Italy",
};
