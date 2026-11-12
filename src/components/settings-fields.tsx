import type { StampDutyMode } from "@prisma/client";
import { parseStatementOverrides, presetStatement } from "@/lib/fiscal/statements";
import { CUSTOMER_CATEGORIES, type FiscalRegime } from "@/lib/fiscal/types";
import { CATEGORY_LABELS } from "@/lib/format";
import type { CompanyDefaults, OverridableKey, ProjectOverrides } from "@/lib/projects/config";
import { labelOf, type Lookups, type Option } from "@/lib/projects/lookups";
import { OverrideField } from "./override-field";

const STAMP_DUTY_LABELS: Record<StampDutyMode, string> = {
  CHARGED_TO_CUSTOMER: "Charged to customer (amount + €2 line)",
  INCLUDED: "Included, borne by you (customer pays amount)",
  DISABLED: "Disabled",
};

type Values = Pick<CompanyDefaults, OverridableKey>;

type Props =
  | { mode: "company"; regime: FiscalRegime; company: CompanyDefaults; lookups: Lookups }
  | { mode: "project"; regime: FiscalRegime; company: CompanyDefaults; project: ProjectOverrides; lookups: Lookups };

function IdControl({
  name,
  value,
  options,
  hintId,
}: {
  name: string;
  value: number | null;
  options: Option[] | null;
  hintId?: string;
}) {
  if (!options) {
    return (
      <input
        id={name}
        name={name}
        type="number"
        min={1}
        defaultValue={value ?? ""}
        placeholder="Fatture in Cloud id"
        aria-describedby={hintId}
      />
    );
  }
  const known = options.some((o) => o.id === value);
  return (
    <select id={name} name={name} defaultValue={value ?? ""} aria-describedby={hintId}>
      <option value="">Not set</option>
      {value !== null && !known && <option value={value}>#{value} (not found in Fatture in Cloud)</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Field({
  project,
  name,
  label,
  hint,
  inherited,
  wide,
  only,
  children,
}: {
  project: ProjectOverrides | null;
  name: OverridableKey;
  label: string;
  hint?: React.ReactNode;
  inherited: React.ReactNode;
  wide?: boolean;
  /** Shown only under this fiscal regime. */
  only?: FiscalRegime;
  children: React.ReactNode;
}) {
  if (project) {
    return (
      <OverrideField
        name={name}
        label={label}
        inherited={inherited}
        custom={project[name] !== null}
        hint={hint}
        wide={wide}
        only={only}
      >
        {children}
      </OverrideField>
    );
  }
  return (
    <div className={`field${wide ? " wide" : ""}`} data-only={only}>
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && (
        <span className="hint" id={`${name}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * The invoice settings form fields. On a company they are the defaults; on a project each one
 * either follows the company or is customized. The fiscal regime is only set on the company.
 */
export function SettingsFields(props: Props) {
  const { mode, regime, company, lookups } = props;
  const project = mode === "project" ? props.project : null;
  // What the controls start from: the project's own value when customized, else the company's.
  const value = <K extends OverridableKey>(key: K): Values[K] => (project?.[key] ?? company[key]) as Values[K];

  const idField = (
    name: OverridableKey & `${string}Id`,
    label: string,
    options: Option[] | null,
    hint?: React.ReactNode,
    only?: FiscalRegime,
  ) => (
    <Field
      project={project}
      name={name}
      label={label}
      hint={hint}
      only={only}
      inherited={labelOf(options, company[name] as number | null)}
    >
      <IdControl
        name={name}
        value={value(name) as number | null}
        options={options}
        hintId={hint ? `${name}-hint` : undefined}
      />
    </Field>
  );

  const textInherited = (text: string | null, empty: string) => (text ? <code>{text}</code> : empty);
  const ownStatements = parseStatementOverrides(project ? project.fiscalStatements : company.fiscalStatements) ?? {};
  const companyStatements = parseStatementOverrides(company.fiscalStatements) ?? {};

  // A project's regime is the company's. The company form instead follows its regime select (CSS :has).
  const regimeScope = project ? regime : undefined;

  return (
    <>
      <div className="fields" data-regime={regimeScope}>
        {idField(
          "vatTypeId",
          "VAT type",
          lookups.vatTypes,
          <>
            <span data-only="FORFETTARIO">Used for every invoice.</span>
            <span data-only="ORDINARIO">Used for Italian customers.</span>
          </>,
        )}
        {idField(
          "nonTaxableVatTypeId",
          "Non-taxable VAT type",
          lookups.vatTypes,
          "For EU and extra-EU private customers (art. 7-ter).",
          "ORDINARIO",
        )}
        {idField("paymentAccountId", "Payment account", lookups.paymentAccounts)}
        {idField("paymentMethodId", "Payment method", lookups.paymentMethods)}
        <Field
          project={project}
          name="numeration"
          label="Numeration"
          hint={
            project
              ? "Projects with the same numeration on the same company share one number sequence. Empty uses the company's default numeration."
              : "For example /A. Empty uses the company's default numeration."
          }
          inherited={textInherited(company.numeration, "Default numeration")}
        >
          <input
            id="numeration"
            name="numeration"
            type="text"
            defaultValue={value("numeration") ?? ""}
            maxLength={20}
            placeholder={project ? "Empty: default numeration" : "/A"}
            aria-describedby="numeration-hint"
          />
        </Field>
        <Field
          project={project}
          name="itemCode"
          label="Item code"
          hint="Printed on the invoice line. Optional."
          inherited={textInherited(company.itemCode, "None")}
        >
          <input
            id="itemCode"
            name="itemCode"
            type="text"
            defaultValue={value("itemCode") ?? ""}
            maxLength={50}
            aria-describedby="itemCode-hint"
          />
        </Field>
        <Field
          project={project}
          name="eiPaymentMethod"
          label="SDI payment method"
          hint="ModalitaPagamento code. MP08 is payment card."
          inherited={<code>{company.eiPaymentMethod}</code>}
        >
          <input
            id="eiPaymentMethod"
            name="eiPaymentMethod"
            type="text"
            defaultValue={value("eiPaymentMethod") ?? "MP08"}
            pattern="MP[0-9]{2}"
            required
            aria-describedby="eiPaymentMethod-hint"
          />
        </Field>
        <>
          <Field
            project={project}
            name="stampDutyMode"
            label="Stamp duty (bollo)"
            wide
            only="FORFETTARIO"
            inherited={STAMP_DUTY_LABELS[company.stampDutyMode]}
            hint={
              <>
                €2 on invoices above €77.47. <em>Charged to customer</em>: a separate €2
                &ldquo;Rimborso imposta di bollo&rdquo; line, the customer pays amount + €2. <em>Included</em>: you bear
                the €2, the customer pays exactly the amount (fixed checkout prices). <em>Disabled</em>: never applied.
              </>
            }
          >
            <select
              id="stampDutyMode"
              name="stampDutyMode"
              defaultValue={value("stampDutyMode") ?? "CHARGED_TO_CUSTOMER"}
              aria-describedby="stampDutyMode-hint"
            >
              {(Object.keys(STAMP_DUTY_LABELS) as StampDutyMode[]).map((m) => (
                <option key={m} value={m}>
                  {STAMP_DUTY_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          {idField(
            "stampDutyVatTypeId",
            "Stamp duty VAT type",
            lookups.vatTypes,
            "Charged to customer only: VAT type of the €2 bollo line, excluded under art. 15 DPR 633/72.",
            "FORFETTARIO",
          )}
        </>
        <Field
          project={project}
          name="sendToSdi"
          label="Send to SDI"
          hint="After a real invoice is created, ask Fatture in Cloud to transmit it to SDI."
          inherited={company.sendToSdi ? "Automatically" : "Manually, from Fatture in Cloud"}
        >
          <label className="toggle inline-toggle">
            <input id="sendToSdi" type="checkbox" name="sendToSdi" defaultChecked={value("sendToSdi") ?? false} />
            <strong>Automatically</strong>
          </label>
        </Field>
      </div>

      <h3 className="subhead">Fiscal statements</h3>
      <p className="hint" style={{ marginTop: -8 }}>
        {project
          ? "Leave a field empty to use the text shown in it: the company's, or the preset for its regime."
          : "Leave a field empty to use the preset shown in it for the regime."}{" "}
        Not tax advice: check the wording with your accountant.
      </p>
      <div className="fields">
        {CUSTOMER_CATEGORIES.map((category) => {
          const fallback = project
            ? (companyStatements[category] ?? presetStatement(regime, category))
            : presetStatement(regime, category);
          return (
            <div className="field" key={category}>
              <label htmlFor={`statement_${category}`}>
                {CATEGORY_LABELS[category]} <code className="hint">{category}</code>
              </label>
              <textarea
                id={`statement_${category}`}
                name={`statement_${category}`}
                defaultValue={ownStatements[category] ?? ""}
                placeholder={fallback || "(no statement)"}
                maxLength={2000}
              />
              {project && ownStatements[category] === undefined && companyStatements[category] !== undefined && (
                <span className="hint">From the company.</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
