/**
 * ECB euro reference rates (units of a currency per euro), from the ECB data API.
 * Published on TARGET working days around 16:00 CET; a day without rates uses the previous one.
 */

const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR";

export interface EcbRates {
  /** The day the rates were observed, YYYY-MM-DD (the latest on or before the requested day). */
  date: string;
  /** Units of currency per euro, e.g. { USD: 1.1133 }. */
  rates: Record<string, number>;
}

/** Parses the ECB `csvdata` response. */
export function parseEcbCsv(csv: string): EcbRates {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const columns = (head ?? "").split(",");
  const currency = columns.indexOf("CURRENCY");
  const period = columns.indexOf("TIME_PERIOD");
  const value = columns.indexOf("OBS_VALUE");
  if (currency < 0 || period < 0 || value < 0) throw new Error("Unexpected ECB response");
  const rates: Record<string, number> = {};
  let date = "";
  for (const row of rows) {
    const cells = row.split(",");
    const rate = Number(cells[value]);
    if (!cells[currency] || !Number.isFinite(rate) || rate <= 0) continue;
    rates[cells[currency]] = rate;
    if (cells[period] > date) date = cells[period];
  }
  return { date, rates };
}

/** Rates of `day` (YYYY-MM-DD) for the given currencies; EUR is never asked. */
export async function fetchEcbRates(currencies: string[], day: string): Promise<EcbRates> {
  const wanted = [...new Set(currencies.filter((c) => /^[A-Z]{3}$/.test(c) && c !== "EUR"))];
  if (wanted.length === 0) return { date: day, rates: {} };
  const url = `${ECB_URL}/D.${wanted.join("+")}.EUR.SP00.A?endPeriod=${day}&lastNObservations=1&format=csvdata`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  // 404: none of these currencies has an ECB reference rate.
  if (response.status === 404) return { date: day, rates: {} };
  if (!response.ok) throw new Error(`ECB rates: HTTP ${response.status}`);
  return parseEcbCsv(await response.text());
}

/**
 * Euro cents of the report lines at these rates. Null when a currency has no rate: the admin
 * then types the amount. Each currency is converted and rounded on its own, like Apple's payment.
 */
/** Euro cents of one report line at the given rates (units per euro); null without a rate. */
export function lineEuroCents(line: { currency: string; amount: string | number }, rates: Record<string, number> | undefined): number | null {
  const amount = Number(line.amount);
  if (line.currency === "EUR") return Math.round(amount * 100);
  const rate = rates?.[line.currency];
  return rate ? Math.round((amount / rate) * 100) : null;
}

/** Sum of the lines in euro cents; null when a currency has no rate. */
export function estimateCents(lines: { currency: string; amount: string | number }[], rates: Record<string, number>): number | null {
  let total = 0;
  for (const line of lines) {
    const cents = lineEuroCents(line, rates);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}
