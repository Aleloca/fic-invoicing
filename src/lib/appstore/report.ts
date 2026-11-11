/** Parsing of the App Store Connect FINANCIAL report (TSV). */

export interface ReportLine {
  /** "Apple Identifier" of the product (for an in-app purchase, the purchase). */
  appleId: string;
  /** "Vendor Identifier": the SKU the developer gave the product. */
  sku: string;
  title: string;
  /** ISO currency of the partner share, e.g. "USD". */
  currency: string;
  /** Partner share in that currency, as printed by Apple (e.g. "27.70"). */
  amount: string;
  units: number;
  /** Countries of sale, e.g. ["GB"]. */
  countries: string[];
}

/** Exact decimal sum of Apple's amounts ("0.70", "-0.70", "27.70"). */
class Decimal {
  constructor(
    private units: bigint = BigInt(0),
    private scale = 0,
  ) {}

  add(raw: string): void {
    const decimals = raw.split(".")[1]?.length ?? 0;
    const scale = Math.max(this.scale, decimals);
    const value = BigInt(raw.replace(".", ""));
    this.units = this.units * BigInt(10) ** BigInt(scale - this.scale) + value * BigInt(10) ** BigInt(scale - decimals);
    this.scale = scale;
  }

  toString(): string {
    const negative = this.units < BigInt(0);
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, "0");
    const text = this.scale > 0 ? `${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}` : digits;
    return `${negative ? "-" : ""}${text}`;
  }
}

/** Sums the report rows per product and currency. Throws when the columns Apple uses are missing. */
export function parseFinancialReport(tsv: string): ReportLine[] {
  const lines = tsv.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const share = col("Extended Partner Share");
  const currency = col("Partner Share Currency");
  const quantity = col("Quantity");
  const country = col("Country Of Sale");
  const appleId = col("Apple Identifier");
  const sku = col("Vendor Identifier");
  const title = col("Title");
  if (share < 0 || currency < 0 || quantity < 0 || appleId < 0) throw new Error("Unexpected App Store financial report format");

  const groups = new Map<string, { line: Omit<ReportLine, "amount" | "countries">; sum: Decimal; countries: Set<string> }>();
  for (const line of lines.slice(1)) {
    // The rows end at "Total_Rows"; a per-country summary follows.
    if (line.startsWith("Total_Rows") || line.trim() === "") break;
    const cells = line.split("\t").map((c) => c.trim());
    const code = cells[currency];
    const raw = cells[share] ?? "";
    if (!code || !/^-?\d+(\.\d+)?$/.test(raw) || !cells[appleId]) continue;
    const key = `${cells[appleId]}|${code}`;
    const group = groups.get(key) ?? {
      line: { appleId: cells[appleId], sku: sku >= 0 ? cells[sku] : "", title: title >= 0 ? cells[title] : "", currency: code, units: 0 },
      sum: new Decimal(),
      countries: new Set<string>(),
    };
    group.sum.add(raw);
    group.line.units += Number(cells[quantity]) || 0;
    if (country >= 0 && cells[country]) group.countries.add(cells[country]);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ ...g.line, amount: g.sum.toString(), countries: [...g.countries].sort() }));
}
