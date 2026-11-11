import type { Metadata } from "next";
import { Marked } from "marked";
import { CopyButton } from "@/components/copy-button";
import { Download } from "@/components/icons";
import { apiGuideMarkdown } from "@/lib/api-guide";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "API reference" };

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function render(markdown: string): { html: string; toc: { id: string; text: string }[] } {
  const toc: { id: string; text: string }[] = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slug(text);
        if (depth === 2) toc.push({ id, text: text.replace(/<[^>]+>/g, "") });
        // The page has its own h1; the guide's title is dropped from the rendered page.
        if (depth === 1) return "";
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  return { html, toc };
}

export default function ApiReferencePage() {
  const markdown = apiGuideMarkdown(env.publicBaseUrl());
  const { html, toc } = render(markdown);

  return (
    <>
      <div className="page-head">
        <h1>API reference</h1>
        <div className="actions">
          <CopyButton text={markdown} label="Copy as Markdown" variant="button" />
          <a className="btn" href="/admin/api/markdown" download="fic-invoicing-api.md">
            <Download />
            Download .md
          </a>
        </div>
        <p className="sub">
          Everything an app needs to issue invoices through this instance. Copy it or download it as Markdown and give
          it to the developer, or to the coding agent, doing the integration.
        </p>
      </div>

      <div className="doc">
        <nav className="doc-toc" aria-label="On this page">
          <span className="label">On this page</span>
          <ul>
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  );
}
