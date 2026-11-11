import { describe, expect, it } from "vitest";
import { getCountryNameForFIC, isEUCountry, isItalianProvince } from "@/lib/fiscal/countries";
import {
  isValidCodiceFiscale,
  isValidItalianZipCode,
  isValidPartitaIva,
  isValidSdiCode,
  normalizePartitaIva,
} from "@/lib/fiscal/validators";

describe("codice fiscale", () => {
  it("accepts valid codes, case-insensitively", () => {
    expect(isValidCodiceFiscale("RSSMRA85T10A562S")).toBe(true);
    expect(isValidCodiceFiscale("rssmra85t10a562s")).toBe(true);
  });
  it("rejects a wrong control character or bad format", () => {
    expect(isValidCodiceFiscale("RSSMRA85T10A562T")).toBe(false);
    expect(isValidCodiceFiscale("RSSMRA85T10A562")).toBe(false);
    expect(isValidCodiceFiscale("12345678901")).toBe(false);
  });
});

describe("partita IVA", () => {
  it("validates the control digit and strips the IT prefix", () => {
    expect(isValidPartitaIva("12345678903")).toBe(true);
    expect(isValidPartitaIva("IT 12345678903")).toBe(true);
    expect(isValidPartitaIva("12345678901")).toBe(false);
    expect(isValidPartitaIva("1234567890")).toBe(false);
    expect(normalizePartitaIva("it12345678903")).toBe("12345678903");
  });
});

describe("other validators", () => {
  it("SDI code, CAP, provinces", () => {
    expect(isValidSdiCode("ABC1234")).toBe(true);
    expect(isValidSdiCode("ABC123")).toBe(false);
    expect(isValidItalianZipCode("00100")).toBe(true);
    expect(isValidItalianZipCode("0010")).toBe(false);
    expect(isItalianProvince("mi")).toBe(true);
    expect(isItalianProvince("XX")).toBe(false);
  });
});

describe("countries", () => {
  it("maps ISO codes to FIC Italian names", () => {
    expect(getCountryNameForFIC("it")).toBe("Italia");
    expect(getCountryNameForFIC("DE")).toBe("Germania");
    expect(getCountryNameForFIC("US")).toBe("Stati Uniti");
    expect(getCountryNameForFIC("ZZ")).toBeNull();
  });
  it("knows the EU members", () => {
    expect(isEUCountry("fr")).toBe(true);
    expect(isEUCountry("CH")).toBe(false);
    expect(isEUCountry("GB")).toBe(false);
  });
});
