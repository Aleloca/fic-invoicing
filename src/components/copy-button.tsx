"use client";

import { useState } from "react";
import { Check, Copy } from "./icons";

/**
 * Copies `text` to the clipboard. `icon` is the compact square used inside command blocks;
 * `button` is a full secondary button that shows its label.
 */
export function CopyButton({
  text,
  label = "Copy command",
  variant = "icon",
}: {
  text: string;
  label?: string;
  variant?: "icon" | "button";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (variant === "button") {
    return (
      <button type="button" className="btn secondary" onClick={copy} aria-live="polite">
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="copy"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={copy}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}
