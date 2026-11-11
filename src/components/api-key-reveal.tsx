"use client";

import { useState } from "react";
import { Check, Copy } from "./icons";

export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="key-reveal">
      <h3>Copy this API key now</h3>
      <p>It is stored hashed and will not be shown again. Put it in your app&apos;s environment.</p>
      <div className="key-value">
        <code>{apiKey}</code>
        <button type="button" className="btn secondary" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
