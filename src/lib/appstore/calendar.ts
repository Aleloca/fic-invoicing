/**
 * Apple's fiscal calendar, as used by App Store Connect financial reports.
 *
 * The fiscal year ends on the last Saturday of September. Each quarter has three periods of
 * 5, 4 and 4 weeks; the last period of the year absorbs the extra week of a 53-week year.
 * Period 1 is "October", period 12 "September". The API names a period "<fiscal year>-<period>":
 * May 2026 (3–30 May) is "2026-08", September 2026 (30 Aug – 26 Sep) is "2026-12".
 */

const DAY = 24 * 60 * 60 * 1000;

export interface FiscalPeriod {
  /** "<fiscal year>-<period>", the `reportDate` of the API. */
  code: string;
  fiscalYear: number;
  period: number;
  /** First day, UTC midnight. */
  start: Date;
  /** Last day (a Saturday), UTC midnight. */
  end: Date;
  /** Calendar month the period is named after, 1–12. */
  month: number;
  /** Calendar year of that month. */
  year: number;
}

const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Last Saturday of September of a calendar year: the last day of that fiscal year. */
function fiscalYearEnd(year: number): Date {
  const last = new Date(Date.UTC(year, 8, 30));
  const back = (last.getUTCDay() + 1) % 7; // days back to Saturday (6)
  return new Date(last.getTime() - back * DAY);
}

export function periodFromCode(code: string): FiscalPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(code);
  const fiscalYear = match ? Number(match[1]) : NaN;
  const period = match ? Number(match[2]) : NaN;
  if (!match || period < 1 || period > 12) throw new Error(`Invalid Apple fiscal period: ${code}`);

  const yearStart = new Date(fiscalYearEnd(fiscalYear - 1).getTime() + DAY);
  let start = yearStart;
  for (let p = 1; p < period; p += 1) start = new Date(start.getTime() + (p % 3 === 1 ? 5 : 4) * 7 * DAY);
  const end =
    period === 12 ? fiscalYearEnd(fiscalYear) : new Date(start.getTime() + ((period % 3 === 1 ? 5 : 4) * 7 - 1) * DAY);
  const month = ((period + 8) % 12) + 1;
  return { code, fiscalYear, period, start, end, month, year: period <= 3 ? fiscalYear - 1 : fiscalYear };
}

export function nextCode(code: string): string {
  const { fiscalYear, period } = periodFromCode(code);
  return period === 12 ? `${fiscalYear + 1}-01` : `${fiscalYear}-${String(period + 1).padStart(2, "0")}`;
}

export function previousCode(code: string): string {
  const { fiscalYear, period } = periodFromCode(code);
  return period === 1 ? `${fiscalYear - 1}-12` : `${fiscalYear}-${String(period - 1).padStart(2, "0")}`;
}

/** The fiscal period containing a day. */
export function periodOf(date: Date): FiscalPeriod {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const fiscalYear = day > fiscalYearEnd(date.getUTCFullYear()).getTime() ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  for (let p = 1; p <= 12; p += 1) {
    const period = periodFromCode(`${fiscalYear}-${String(p).padStart(2, "0")}`);
    if (day <= period.end.getTime()) return period;
  }
  throw new Error("unreachable");
}

/** The latest period that has ended before `now`. */
export function lastEndedPeriod(now: Date = new Date()): FiscalPeriod {
  return periodFromCode(previousCode(periodOf(now).code));
}

/** "settembre 2026", as on the invoice. */
export function labelIt(period: FiscalPeriod): string {
  return `${MONTHS_IT[period.month - 1]} ${period.year}`;
}

/** "September 2026", as in the admin (and on App Store Connect). */
export function labelEn(period: FiscalPeriod): string {
  return `${MONTHS_EN[period.month - 1]} ${period.year}`;
}

/** "YYYY-MM-DD" of a UTC-midnight date. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
