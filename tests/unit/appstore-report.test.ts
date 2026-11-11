import { describe, expect, it } from "vitest";
import { estimateCents, parseEcbCsv } from "@/lib/appstore/ecb";
import { parseFinancialReport } from "@/lib/appstore/report";

const HEADER =
  "Start Date\tEnd Date\tUPC\tISRC/ISBN\tVendor Identifier\tQuantity\tPartner Share\tExtended Partner Share\tPartner Share Currency\tSales or Return\tApple Identifier\tArtist/Show/Developer/Author\tTitle\tLabel/Studio/Network/Developer/Publisher\tGrid\tProduct Type Identifier\tISAN/Other Identifier\tCountry Of Sale\tPre-order Flag\tPromo Code\tCustomer Price\tCustomer Currency";
const row = (qty: number, share: string, ext: string, cur: string, country: string) =>
  `08/30/2026\t09/26/2026\t\t\tapp_pro_unlock\t${qty}\t${share}\t${ext}\t${cur}\tS\t123\t\tPro Unlock\t\t\tIA1\t\t${country}\t\t\t0.99\t${cur}`;

// Same layout as the real report Apple returned for September 2026.
const SEPTEMBER = [
  HEADER,
  row(1, "0.57", "0.57", "GBP", "GB"),
  row(1, "27.70", "27.70", "TRY", "TR"),
  "Total_Rows\t2",
  "Country Of Sale\tPartner Share Currency\tQuantity\tExtended Partner Share",
  "GB\tGBP\t1\t0.57",
  "TR\tTRY\t1\t27.70",
].join("\n");

describe("App Store financial report", () => {
  it("sums the partner share per currency and ignores the summary after Total_Rows", () => {
    expect(parseFinancialReport(SEPTEMBER)).toEqual([
      { currency: "GBP", amount: "0.57", units: 1, countries: ["GB"] },
      { currency: "TRY", amount: "27.70", units: 1, countries: ["TR"] },
    ]);
  });

  it("adds rows of one currency exactly, across countries, including returns", () => {
    const tsv = [HEADER, row(6, "0.70", "4.20", "USD", "US"), row(2, "0.70", "1.40", "USD", "CA"), row(-1, "0.70", "-0.70", "USD", "US"), "Total_Rows\t3"].join("\n");
    expect(parseFinancialReport(tsv)).toEqual([{ currency: "USD", amount: "4.90", units: 7, countries: ["CA", "US"] }]);
  });

  it("refuses an unknown layout", () => {
    expect(() => parseFinancialReport("a\tb\n1\t2")).toThrow(/format/);
  });
});

describe("ECB rates", () => {
  const CSV = [
    "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS",
    "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-10-28,0.83785,A",
    "EXR.D.TRY.EUR.SP00.A,D,TRY,EUR,SP00,A,2026-10-28,55.4846,A",
  ].join("\n");

  it("parses the csvdata response", () => {
    expect(parseEcbCsv(CSV)).toEqual({ date: "2026-10-28", rates: { GBP: 0.83785, TRY: 55.4846 } });
  });

  it("reproduces Apple's September 2026 payment: 0.57 GBP + 27.70 TRY = 1.18 EUR", () => {
    const lines = parseFinancialReport(SEPTEMBER);
    expect(estimateCents(lines, parseEcbCsv(CSV).rates)).toBe(118);
  });

  it("has no estimate when a currency has no ECB rate", () => {
    expect(estimateCents([{ currency: "SAR", amount: "10.00" }], {})).toBeNull();
    expect(estimateCents([{ currency: "EUR", amount: "2.50" }], {})).toBe(250);
  });
});
