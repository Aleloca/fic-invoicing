import { describe, expect, it } from "vitest";
import {
  isoDay,
  labelEn,
  labelIt,
  lastEndedPeriod,
  nextCode,
  periodFromCode,
  periodOf,
  previousCode,
} from "@/lib/appstore/calendar";

describe("Apple fiscal calendar", () => {
  // Periods and dates as returned by the App Store Connect API for a real account.
  it.each([
    ["2026-08", "2026-05-03", "2026-05-30", "May 2026"],
    ["2026-09", "2026-05-31", "2026-06-27", "June 2026"],
    ["2026-11", "2026-08-02", "2026-08-29", "August 2026"],
    ["2026-12", "2026-08-30", "2026-09-26", "September 2026"],
  ])("%s is %s – %s (%s)", (code, start, end, label) => {
    const period = periodFromCode(code);
    expect(isoDay(period.start)).toBe(start);
    expect(isoDay(period.end)).toBe(end);
    expect(labelEn(period)).toBe(label);
  });

  it("starts the fiscal year after the last Saturday of September, with a 5-week October", () => {
    const p1 = periodFromCode("2027-01");
    expect(isoDay(p1.start)).toBe("2026-09-27");
    expect(isoDay(p1.end)).toBe("2026-10-31");
    expect(labelIt(p1)).toBe("ottobre 2026");
    expect(labelEn(periodFromCode("2027-04"))).toBe("January 2027");
  });

  it("chains every period of a year without gaps, ending on the last Saturday of September", () => {
    for (const year of [2025, 2026, 2027, 2028]) {
      let previousEnd = periodFromCode(`${year - 1}-12`).end;
      for (let p = 1; p <= 12; p += 1) {
        const period = periodFromCode(`${year}-${String(p).padStart(2, "0")}`);
        expect(period.start.getTime() - previousEnd.getTime()).toBe(24 * 60 * 60 * 1000);
        expect(period.end.getUTCDay()).toBe(6);
        previousEnd = period.end;
      }
      expect(previousEnd.getUTCMonth()).toBe(8);
      expect(previousEnd.getUTCDate()).toBeGreaterThan(23);
    }
  });

  it("moves between periods across fiscal years", () => {
    expect(nextCode("2026-12")).toBe("2027-01");
    expect(previousCode("2027-01")).toBe("2026-12");
    expect(nextCode("2026-08")).toBe("2026-09");
  });

  it("finds the period of a day and the last ended one", () => {
    expect(periodOf(new Date("2026-09-26T12:00:00Z")).code).toBe("2026-12");
    expect(periodOf(new Date("2026-09-27T00:00:00Z")).code).toBe("2027-01");
    expect(periodOf(new Date("2026-11-11T21:00:00Z")).code).toBe("2027-02");
    expect(lastEndedPeriod(new Date("2026-11-11T21:00:00Z")).code).toBe("2027-01");
  });
});
