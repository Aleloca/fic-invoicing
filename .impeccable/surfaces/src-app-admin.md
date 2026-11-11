---
version: 1
slug: "src-app-admin"
primary_target: "src/app/admin"
related_targets: ["src/components"]
---

# Admin panel

Scope: `src/app/admin/**` (login, projects list, new project, project detail, company choice, per-project invoices) plus a new read-only cross-project invoices view. Visitor mode: Operate.

Audience and job: self-hosting developers set up projects (API key, Fatture in Cloud connection, fiscal configuration) once and return occasionally; accountants, administration staff and partners check which invoices were issued, failed, are in dry run or deleted. Constraints: server actions, form field names, API and Prisma schema unchanged. Tone must not be playful.

Memorable moment: every project's setup drawn as a metro line, from Created to Live, so anyone sees at a glance how far it has come and what the next stop is.

## Direction contract

THESIS: The panel is a Milan metro map of the instance. Each project is a line whose stations are its setup steps (Created, Company, Connected, Configured, Dry run, Live) and the current stop is marked. It refuses the category default: grey sidebar, white cards, pastel status pills.

OWN-WORLD: Noorda/Unimark Milan metro and Olivetti identity. White ground, a solid signal-red (#e3001b-family) navigation rail, near-black ink, a light warm grey for quiet fields, green only for live/issued. Bold tight grotesque (Inter Tight) with heavy display weights and a 2px black rule as the section divider. Square corners. State colours: red is the brand AND the rail, so errors use a darker red with an icon/mark and text, never colour alone.

STORY: The operator opens the panel, sees every project as a line, knows which ones are live, which are stuck at which stop, and which have failed invoices; one click on a stop leads to the step that finishes it. The accountant goes to Invoices, filters by project, status and period, and reads statuses in plain words.

FIRST VIEWPORT: Left: a 220px red rail with the product name on top, Projects, Invoices, API docs, Sign out at the bottom (on mobile the rail becomes a red top band). Main: "Projects" at 44px extra-bold with a black "New project" button on the right. Below, one row per project separated by 2px black rules: name and slug/regime on the left, the six-station line in the middle, invoice count large on the right, failed count in red under the name.

FORM: Milano Moderna, my top-ranked grounded candidate (position 1), chosen as IMPECCABLE’S PICK over the assigned direction. seed:98f804dbf4489278

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
