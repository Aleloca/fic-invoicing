/** Parsing of the App Store Connect FINANCIAL report (TSV). */

export interface ReportLine {
  /** ISO currency of the partner share, e.g. "USD". */
  currency: string;
  /** Partner share in that currency, as printed by Apple (e.g. "27.70"). */
  amount: string;
  units: number;
  /** Countries of sale, e.g. ["GB"]. */
  countries: string[];
}

/** Sums the report rows per currency. Throws when the columns Apple uses are missing. */
export function parseFinancialReport(tsv: string): ReportLine[] {
  const lines = tsv.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const share = col("Extended Partner Share");
  const currency = col("Partner Share Currency");
  const quantity = col("Quantity");
  const country = col("Country Of Sale");
  if (share < 0 || currency < 0 || quantity < 0) throw new Error("Unexpected App Store financial report format");

  const byCurrency = new Map<string, { cents: bigint; decimals: number; units: number; countries: Set<string> }>();
  for (const line of lines.slice(1)) {
    // The rows end at "Total_Rows"; a per-country summary follows.
    if (line.startsWith("Total_Rows") || line.trim() === "") break;
    const cells = line.split("\t");
    const code = cells[currency]?.trim();
    const raw = cells[share]?.trim() ?? "";
    if (!code || !/^-?\d+(\.\d+)?$/.test(raw)) continue;
    const decimals = raw.split(".")[1]?.length ?? 0;
    const entry = byCurrency.get(code) ?? { cents: BigInt(0), decimals, units: 0, countries: new Set<string>() };
    const scale = Math.max(entry.decimals, decimals);
    const toScale = (value: bigint, from: number) => value * BigInt(10) ** BigInt(scale - from);
    entry.cents = toScale(entry.cents, entry.decimals) + toScale(BigInt(raw.replace(".", "")), decimals);
    entry.decimals = scale;
    entry.units += Number(cells[quantity]) || 0;
    if (country >= 0 && cells[country]?.trim()) entry.countries.add(cells[country].trim());
    byCurrency.set(code, entry);
  }

  return [...byCurrency.entries()].map(([code, e]) => {
    const negative = e.cents < BigInt(0);
    const digits = (negative ? -e.cents : e.cents).toString().padStart(e.decimals + 1, "0");
    const amount = e.decimals > 0 ? `${digits.slice(0, -e.decimals)}.${digits.slice(-e.decimals)}` : digits;
    return { currency: code, amount: `${negative ? "-" : ""}${amount}`, units: e.units, countries: [...e.countries].sort() };
  });
}
