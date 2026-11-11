/**
 * Validators for Italian fiscal identifiers. Pure functions, no dependencies.
 */

const CF_PATTERN =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

// Values for characters in odd positions (1st, 3rd, ...), indexed by 0-9 then A-Z.
const CF_ODD_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, // 0-9
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23, // A-Z
];

function cfCharIndex(char: string): number {
  const code = char.charCodeAt(0);
  return code <= 57 ? code - 48 : code - 65 + 10;
}

/** Computes the control character of the first 15 characters of a codice fiscale. */
export function codiceFiscaleCheckChar(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const idx = cfCharIndex(first15[i]);
    if (i % 2 === 0) {
      sum += CF_ODD_VALUES[idx];
    } else {
      sum += idx < 10 ? idx : idx - 10;
    }
  }
  return String.fromCharCode(65 + (sum % 26));
}

/** Validates a 16-character personal codice fiscale (format and control character, omocodia allowed). */
export function isValidCodiceFiscale(value: string): boolean {
  const cf = value.trim().toUpperCase();
  if (!CF_PATTERN.test(cf)) return false;
  return codiceFiscaleCheckChar(cf.slice(0, 15)) === cf[15];
}

/** Normalises an Italian VAT number: strips spaces and an optional "IT" prefix. */
export function normalizePartitaIva(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase().replace(/^IT/, "");
}

/** Validates an Italian partita IVA (11 digits, Luhn-like control digit). */
export function isValidPartitaIva(value: string): boolean {
  const piva = normalizePartitaIva(value);
  if (!/^\d{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = piva.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === piva.charCodeAt(10) - 48;
}

/** SDI recipient code (codice destinatario) for B2B: 7 alphanumeric characters. */
export function isValidSdiCode(value: string): boolean {
  return /^[A-Z0-9]{7}$/.test(value.trim().toUpperCase());
}

/** Italian postal code (CAP): exactly 5 digits. */
export function isValidItalianZipCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

/** Generic international postal code. */
export function isValidZipCode(value: string): boolean {
  return /^[A-Za-z0-9\s-]{2,12}$/.test(value.trim());
}
