"use client";

import { useEffect, useState } from "react";

const parse = (raw: string): number | null => {
  const clean = raw.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : null;
};

const format = (cents: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);

/** The sum of the `amount_*` fields of a form, updated as the admin types. */
export function LiveTotal({ formId, initialCents }: { formId: string; initialCents: number }) {
  const [cents, setCents] = useState(initialCents);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const update = () => {
      let sum = 0;
      form.querySelectorAll<HTMLInputElement>('input[name^="amount_"]').forEach((input) => {
        sum += parse(input.value) ?? 0;
      });
      setCents(sum);
    };
    form.addEventListener("input", update);
    return () => form.removeEventListener("input", update);
  }, [formId]);
  return <output className="num">{format(cents)}</output>;
}
