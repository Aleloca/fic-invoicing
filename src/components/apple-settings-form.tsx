import type { AppleAccount } from "@prisma/client";
import { labelEn, lastEndedPeriod, nextCode, periodFromCode, previousCode, isoDay } from "@/lib/appstore/calendar";
import { APPLE_DISTRIBUTION_INTERNATIONAL, parseCustomer } from "@/lib/appstore/payload";
import type { Lookups, Option } from "@/lib/projects/lookups";
import { saveAppleAccountAction } from "@/app/admin/actions";
import { SectionHead } from "./section-head";
import { Notice } from "./notices";

function IdSelect({ name, label, value, options, hint }: { name: string; label: string; value: number | null; options: Option[] | null; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {options ? (
        <select id={name} name={name} defaultValue={value ?? ""}>
          <option value="">Not set</option>
          {value !== null && !options.some((o) => o.id === value) && <option value={value}>#{value} (not found)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={name} name={name} type="number" min={1} defaultValue={value ?? ""} placeholder="Fatture in Cloud id" />
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/**
 * Credentials and invoice settings of an Apple account. Used to create one (no account) and to
 * edit it. The lists come from the account's Fatture in Cloud company, once chosen and saved.
 */
export function AppleSettingsForm({
  account,
  companies,
  lookups,
}: {
  account: AppleAccount | null;
  companies: { id: string; label: string }[];
  lookups: Lookups;
}) {
  const customer = account ? parseCustomer(account.customer) : APPLE_DISTRIBUTION_INTERNATIONAL;
  // The first period to invoice: the last 12 ended periods and the current one.
  const periods: string[] = [];
  for (let code = nextCode(lastEndedPeriod().code), i = 0; i < 13; i += 1, code = previousCode(code)) periods.push(code);
  const step = (n: number) => (account ? undefined : n);

  return (
    <form action={saveAppleAccountAction.bind(null, account?.id ?? null)}>
      <section className="section" id="settings">
        <SectionHead step={step(1)} title="App Store Connect">
          A team API key with the Finance role, from Users and Access → Integrations → App Store Connect API. It only
          reads financial reports.
        </SectionHead>
        <div className="section-body">
          <div className="fields">
            <div className="field">
              <label htmlFor="label">Name</label>
              <input id="label" name="label" type="text" required maxLength={100} defaultValue={account?.label ?? ""} placeholder="My Apple developer account" />
            </div>
            <div className="field">
              <label htmlFor="vendorNumber">Vendor number</label>
              <input id="vendorNumber" name="vendorNumber" type="text" inputMode="numeric" required defaultValue={account?.vendorNumber ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="issuerId">Issuer ID</label>
              <input id="issuerId" name="issuerId" type="text" required defaultValue={account?.issuerId ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="keyId">Key ID</label>
              <input id="keyId" name="keyId" type="text" required defaultValue={account?.keyId ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="privateKey">Private key (.p8)</label>
              <input id="privateKey" name="privateKey" type="file" accept=".p8" required={!account} aria-describedby="privateKey-hint" />
              <span className="hint" id="privateKey-hint">
                {account ? "Stored encrypted. Upload only to replace it." : "Stored encrypted, never shown again."}
              </span>
            </div>
            <div className="field">
              <label htmlFor="startPeriod">{account ? "Next report expected" : "First month to invoice"}</label>
              <select id="startPeriod" name="startPeriod" defaultValue={account?.nextPeriod ?? ""} aria-describedby="startPeriod-hint">
                {!account && <option value="">The one after the latest report (suggested)</option>}
                {periods.map((code) => {
                  const p = periodFromCode(code);
                  return (
                    <option key={code} value={code}>
                      {labelEn(p)} ({isoDay(p.start)} – {isoDay(p.end)})
                    </option>
                  );
                })}
              </select>
              <span className="hint" id="startPeriod-hint">
                Earlier reports are taken as already invoiced.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="invoice">
        <SectionHead step={step(2)} title="Invoice to Apple">
          One invoice per monthly report, one line per project. Not tax advice: confirm customer, VAT type and
          statement with your accountant.
        </SectionHead>
        <div className="section-body">
          {lookups.error && (
            <Notice tone="error" className="inline">
              Could not load the lists from Fatture in Cloud: {lookups.error}
            </Notice>
          )}
          <div className="fields">
            <div className="field">
              <label htmlFor="companyId">Issued by</label>
              <select id="companyId" name="companyId" defaultValue={account?.companyId ?? (companies.length === 1 ? companies[0].id : "")} aria-describedby="companyId-hint">
                <option value="">Choose the company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="hint" id="companyId-hint">
                The Fatture in Cloud company Apple pays. Numeration and sending to SDI follow its defaults.
              </span>
            </div>
            <label className="toggle inline-toggle field-toggle">
              <input type="checkbox" name="dryRun" defaultChecked={account?.dryRun ?? true} />
              <strong>Dry run</strong>
              <span className="hint">Invoices to Apple are only validated, nothing is created in Fatture in Cloud.</span>
            </label>
          </div>

          <h3 className="subhead">Customer</h3>
          <div className="fields">
            <div className="field">
              <label htmlFor="customerName">Name</label>
              <input id="customerName" name="customerName" type="text" required defaultValue={customer.name} />
            </div>
            <div className="field">
              <label htmlFor="customerVatNumber">VAT number</label>
              <input id="customerVatNumber" name="customerVatNumber" type="text" required defaultValue={customer.vatNumber} />
            </div>
            <div className="field">
              <label htmlFor="customerAddress">Address</label>
              <input id="customerAddress" name="customerAddress" type="text" defaultValue={customer.address} />
            </div>
            <div className="field">
              <label htmlFor="customerZipCode">Postal code</label>
              <input id="customerZipCode" name="customerZipCode" type="text" defaultValue={customer.zipCode} />
            </div>
            <div className="field">
              <label htmlFor="customerCity">City</label>
              <input id="customerCity" name="customerCity" type="text" defaultValue={customer.city} />
            </div>
            <div className="field">
              <label htmlFor="customerProvince">County / province</label>
              <input id="customerProvince" name="customerProvince" type="text" defaultValue={customer.province} />
            </div>
            <div className="field">
              <label htmlFor="customerCountryCode">Country</label>
              <input id="customerCountryCode" name="customerCountryCode" type="text" required maxLength={2} defaultValue={customer.countryCode} aria-describedby="customerCountryCode-hint" />
              <span className="hint" id="customerCountryCode-hint">
                ISO code. Outside Italy the SDI recipient code is XXXXXXX.
              </span>
            </div>
          </div>

          <h3 className="subhead">Lines and payment</h3>
          <div className="fields">
            <div className="field">
              <label htmlFor="itemName">Line name</label>
              <input id="itemName" name="itemName" type="text" required defaultValue={account?.itemName ?? "Distribuzione applicazioni mobili"} />
            </div>
            <IdSelect name="vatTypeId" label="VAT type" value={account?.vatTypeId ?? null} options={lookups.vatTypes} hint="Operations not subject to VAT, art. 7-ter (N2.1)." />
            <IdSelect name="paymentAccountId" label="Payment account" value={account?.paymentAccountId ?? null} options={lookups.paymentAccounts} hint="The bank account Apple pays into." />
            <IdSelect name="paymentMethodId" label="Payment method" value={account?.paymentMethodId ?? null} options={lookups.paymentMethods} hint="Bank transfer." />
            <div className="field">
              <label htmlFor="eiPaymentMethod">SDI payment method</label>
              <input id="eiPaymentMethod" name="eiPaymentMethod" type="text" pattern="MP[0-9]{2}" required defaultValue={account?.eiPaymentMethod ?? "MP05"} aria-describedby="eiPaymentMethod-hint" />
              <span className="hint" id="eiPaymentMethod-hint">
                MP05 is bank transfer.
              </span>
            </div>
            <div className="field wide">
              <label htmlFor="statement">Statement</label>
              <textarea id="statement" name="statement" maxLength={2000} defaultValue={account?.statement ?? ""} placeholder="Optional, printed in the notes." />
            </div>
          </div>
          {!lookups.vatTypes && (
            <p className="hint">Choose the company and save: the VAT types and payment lists then come from Fatture in Cloud.</p>
          )}
          <p className="hint">
            Forfettario: above €77.47 the €2 stamp duty is declared and borne by you, never charged to Apple.
          </p>
          <div className="form-foot">
            <button type="submit" className="btn">
              {account ? "Save settings" : "Connect App Store Connect"}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}
