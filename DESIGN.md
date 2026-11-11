---
name: fic-invoicing
description: Self-hosted Italian e-invoicing service, drawn as a Milan metro map.
colors:
  paper: "#ffffff"
  field: "#f3f2ef"
  field-2: "#e8e7e3"
  ink: "#111111"
  ink-2: "#3f3f3d"
  ink-3: "#626260"
  hair: "#d6d5d0"
  rule: "#111111"
  signal-red: "#e3001b"
  red-ink: "#b10016"
  on-red: "#ffffff"
  on-red-2: "#ffe3e6"
  line-green: "#00843d"
typography:
  display:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(56px, 11.2vw, 168px)"
    fontWeight: 800
    lineHeight: 0.86
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(32px, 4.2vw, 46px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"ss01\", \"cv11\""
  label:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.5
  table-head:
    fontFamily: "Inter Tight, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.88em"
    fontWeight: 500
rounded:
  none: "0"
  dot: "50%"
spacing:
  xs: "8px"
  sm: "14px"
  md: "20px"
  lg: "28px"
  xl: "40px"
  2xl: "48px"
  gutter: "clamp(16px, 4vw, 48px)"
  rail: "232px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.field}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.red-ink}"
    rounded: "{rounded.none}"
    padding: "0 18px"
    height: "44px"
  button-danger-solid:
    backgroundColor: "{colors.red-ink}"
    textColor: "{colors.paper}"
  button-signal:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.on-red}"
    rounded: "{rounded.none}"
    padding: "0 18px"
    height: "44px"
  button-signal-hover:
    backgroundColor: "{colors.red-ink}"
  button-small:
    padding: "0 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
    height: "44px"
  rail:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.on-red-2}"
    width: "{spacing.rail}"
    padding: "28px 24px 24px"
  notice:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  notice-error:
    backgroundColor: "{colors.field}"
    textColor: "{colors.red-ink}"
  key-reveal:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    padding: "22px"
  tag:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  tag-dry:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  command-block:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
---

# Design System: fic-invoicing

## Overview

**Creative North Star: "Milano Moderna"**

The interface is a Milan metro map of the instance, in the Noorda/Unimark and Olivetti tradition: white ground, a solid signal-red rail, near-black ink, bold tight grotesque type and 2px black rules between sections. Each project is a line whose six stations are its setup steps, and the home page is one line from `git clone` to the first live invoice. The metro line is the system's reusable signature; everything else stays quiet so the line and the statuses read first.

Density is that of an operations panel read by accountants as well as developers: generous row padding (24px project rows, 14px table cells), plain-language status words always next to their marks, and no decoration that is not a wayfinding device. The scene is a daylight office, so the system is light only (`color-scheme: light`); there is no dark theme.

The world rejects the category default it was built against: grey sidebar, white cards, pastel status pills. Depth comes from rules and flat warm-grey fields, never from cards or soft shadows.

**Key Characteristics:**
- Signal-red rail and brand, near-black ink, warm-grey fields, square corners everywhere except station dots.
- 2px black rules as the section divider; 1px hairlines inside lists and tables.
- Inter Tight at 800 for every heading; JetBrains Mono 500 for keys, commands and code.
- State carried by metro marks (filled green dot, hollow ink ring, red-ink triangle), always with a word.
- Light only.

## Colors

A transit palette: one loud signal red, one ink, one warm grey family, and a single green reserved for the end of the line.

### Primary
- **Signal Red** (`signal-red`): the brand and the rail. The admin rail and its mobile top band, the login brand panel, the home "Not tax advice" band, the second half of the home wordmark, the progress fill of a setup line, the active status tab underline, completed section step numbers, input focus rings and text selection. It is never used to mean "error".
- **Red Ink** (`red-ink`): the error and destructive colour, a darker red that always travels with a mark or icon and words. Failed status, problem stations (dashed ring), error notices' top rule and text, danger buttons, invalid inputs, the confirm box's top rule, home station numbers and the home "Admin" link.

### Secondary
- **Line Green** (`line-green`): only for live and issued. Issued/connected/live status dots, the live project line, the final "Live" station on the home line, the success notice's check icon.

### Neutral
- **Paper** (`paper`): page ground, input backgrounds, hollow ring centres.
- **Field** (`field`): warm grey for quiet surfaces: notices, the confirm box, the key reveal, the filter bar, plain tags, button-secondary hover, row hover.
- **Field Deep** (`field-2`): the unreached part of a metro line and unreached station rings, status-tab hover underline.
- **Ink** (`ink`): text, primary buttons, input borders, command blocks, focus outlines.
- **Ink 2** (`ink-2`): secondary text, sub-lines, table headers, primary button hover.
- **Ink 3** (`ink-3`): tertiary text: meta, hints, counts, placeholders, deleted and off marks.
- **Hair** (`hair`): 1px dividers inside facts, toggles, choices and table rows.
- **Rule** (`rule`): the 2px structural divider (same value as ink, separate role).
- **On Red / On Red 2** (`on-red`, `on-red-2`): text on signal red; full white for current and hover, pink-white for resting rail links and body copy on red.

### Named Rules
**The Red Is Not An Error Rule.** Signal red is the brand and the rail. Errors use red ink plus a mark (triangle, dashed ring or alert icon) plus words, never colour alone and never signal red.

**The End Of The Line Rule.** Green appears only for live and issued (and the success check). Dry run and pending are never green.

**The No Wash Rule.** There are no tinted or pastel backgrounds. Every notice, the confirm box and the key reveal sit on warm grey (`field`) and are told apart by their top rule: ink by default, red ink for errors and confirmations, signal red for the key reveal.

## Typography

**Display Font:** Inter Tight (with Helvetica Neue, Arial), loaded at 400 to 800.
**Body Font:** Inter Tight, 15px, stylistic sets `ss01` and `cv11`.
**Label/Mono Font:** JetBrains Mono 500, ligatures off, for API keys, commands, code and slugs.

**Character:** A bold, tight grotesque in the Unimark signage tradition: heavy 800 headings with negative tracking against plain 400 body copy, plus a technical mono for anything the operator copies.

### Hierarchy
- **Display** (800, clamp 56 to 168px, 0.86): the home wordmark only, never wrapping; the login brand panel uses the same voice at clamp 40 to 76px.
- **Headline** (800, clamp 32 to 46px, 1.02): page titles in the admin page head.
- **Title** (800, 22px, 1.15): section and empty-state headings; project names at 21px; subheads at 20px; home section headings at clamp 26 to 36px.
- **Body** (400, 15px, 1.5): running text; descriptive sub-lines cap at 68ch, home prose at 17px.
- **Label** (700, 14px): form labels; hints are 13px in ink-3.
- **Table head** (700, 12px, 0.06em, uppercase): column headers only.
- **Numbers**: tabular figures in tables, counts and totals; project invoice counts at 30px/800.

### Named Rules
**The Heavy Or Plain Rule.** Headings are 800; body is 400; labels and controls are 600 to 700. No light display weights.

**The Copy Is Mono Rule.** Anything a reader copies or types into a terminal (API key, command, request, slug) is JetBrains Mono.

## Layout

The admin shell is a two-column grid: a sticky 232px signal-red rail and a workspace padded `40px gutter 96px`, content capped at 1180px. The gutter is fluid (`clamp(16px, 4vw, 48px)`). Pages open with a page head (headline left, actions right, sub-line below) and continue as stacked sections, each a 2px-ruled grid of a 180 to 260px heading column beside the body; sections collapse to one column below 860px.

Project rows are a three-column grid (name and meta, the setup line, the count) separated by 2px rules; below 980px the line drops to its own full-width row. Forms use an auto-fill grid of 260px minimum fields with 22px by 28px gaps.

The home page runs full bleed with the gutter as side padding: top bar, hero (wordmark and lead left, actions right), the six-station quickstart line, then 3:9 sections ruled at the top, the red limit band and the footer.

Breakpoints observed: 980px (project row), 900px (home line turns vertical, hero stacks), 860px (rail becomes a red top band with horizontally scrolling links; sections stack), 760px (login and home sections stack), 640px (setup lines show only the current or problem label; invoice tables stack).

**The Stacked Row Rule.** Below 640px, invoice tables stop being tables: each row becomes a two-column grid placed by `data-col` (number left, status top right, amount right, project/customer/created below in ink-2, details and actions full width), separated by 2px rules.

## Elevation & Depth

Flat. There are no drop shadows. Depth is conveyed by rules (2px ink between sections, 1px hair inside), by the warm-grey field behind quiet content, and by the red rail. The only `box-shadow` uses are rings, not elevation: the current station's double ring, the green end station, the input focus ring (3px paper then 2px signal red), and the inset 2px outline of the dry-run tag.

**The Ruled Not Raised Rule.** Separate with a rule or a field, never with a card or shadow.

## Shapes

Square corners throughout (`rounded.none`): buttons, inputs, notices, tags, code blocks, tables. The only round forms are metro geometry: station dots, status dots, the hollow status ring, numbered section steps and the bullet rings in home lists. The failed mark is a red-ink triangle cut with a clip path. Lines are thick bars (8px in the admin, 10px on the home page) running behind the dots. Icons are hand-drawn 24px SVG strokes at 2.25 with square caps and mitred joins, sized at 1.1em.

## Components

### Buttons
Black, square and confident.
- **Shape:** square (0), 44px minimum height, 2px border, 600 weight; small variant 34px at 14px.
- **Primary:** ink fill, paper text; hover shifts to ink-2.
- **Secondary:** transparent with ink border; hover fills with field.
- **Danger:** red-ink outline and text; `solid` variant fills red ink. Destructive actions sit behind a `details` confirm.
- **Signal:** signal-red fill used for the primary home action; hover deepens to red ink.
- **Disabled:** 55% opacity with a progress cursor.

### Status marks and tags
- **Issued / Live / Connected:** 12px filled green dot plus the word.
- **Pending / Dry run / Attention:** hollow ink ring (3px ink border on paper) plus the word.
- **Failed / Reconnect required:** 14px red-ink triangle plus the word, text in red ink.
- **Deleted:** ink-3, struck through at 2px, with a thin hollow ring; **Off** uses the same ring without the strike.
- **Tag:** square field-grey chip, 12px/700. **Dry-run tag:** paper with a 2px ink inset outline, ink text.
- A legend (`StatusLegend`) spells out every status in plain words for accountants.

### Notices, confirm box and key reveal
- **Notice:** field background, 2px ink top rule, icon then text, capped at 820px. Success swaps the icon colour to green; warnings keep ink; errors switch the top rule and text to red ink at 500 weight with an alert triangle and `role="alert"`.
- **Confirm box:** inside a `details` disclosure, max 300px, field background, 2px red-ink top rule, 13px text.
- **Key reveal:** field background with a 6px signal-red top rule, 18px/800 heading, the key in a mono code box (paper, 2px ink border, `user-select: all`) beside a secondary Copy button.

### Inputs / Fields
- **Style:** 2px ink border, square, paper background, 44px minimum height; selects use a custom 2px chevron.
- **Focus:** outline removed in favour of a 3px paper gap and a 2px signal-red ring.
- **Error:** `:user-invalid` turns the border red ink.
- **Toggles and choices:** rows divided by 1px hair; choice rows highlight with field on hover; checkboxes and radios use ink as accent colour.

### Navigation
- **Rail:** signal red, product name at 21px/800 on top, links divided by 2px translucent white rules, resting links in on-red-2, current page in full white with a solid white rule; Sign out sits at the foot. Below 860px it becomes a sticky red top band with an underline for the current page.
- **Status tabs:** text tabs over a 2px rule; the current tab carries a 4px signal-red underline, counts in ink-3.
- **Filters:** a field-grey bar holding paper-backed fields.

### Setup Line (signature)
The six-station metro line drawn from project fields: Created, Company, Connected, Configured, Dry run, Live. The reached station and the line's progress are derived only from stored data (company chosen, its account's token present and not needing reconnect, the effective configuration — company defaults plus project overrides — complete, dry run off). Reached stations get a red ring, the current one a filled red dot with a paper and red double ring, unreached ones a field-2 ring; a reconnect problem shows a dashed red-ink ring at Connected. When the project is live the whole line turns green. A "next step" link under the project name points to the section that finishes the line.

### Quickstart Line (home signature)
The same grammar at poster scale: a 10px red bar drawing in from the left over 1400ms (disabled under reduced motion), six 40px stations numbered 01 to 06 in red ink, each with a title, a sentence and a black command block with a copy button; the final Live station is green. Below 900px the line runs vertically.

### Command and code blocks
Ink backgrounds with paper text in JetBrains Mono; request and response sit side by side in a 3:2 grid with uppercase captions.

## Do's and Don'ts

### Do:
- **Do** divide sections with a 2px ink rule and list items with a 1px hair.
- **Do** pair every status colour with a mark shape and a plain word.
- **Do** keep notices, confirmations and the key reveal on `field` and distinguish them by their top rule.
- **Do** derive any setup line from stored project fields, six stations, from Created to Live.
- **Do** set `color-scheme: light` and design for daylight only.
- **Do** keep corners square; reserve round forms for stations and status dots.

### Don't:
- **Don't** use signal red for errors or failure; use red ink with a mark.
- **Don't** use green for dry run, pending or anything that is not live or issued.
- **Don't** use tinted or pastel washes for notices or statuses.
- **Don't** use cards, rounded corners or drop shadows for separation.
- **Don't** introduce a dark theme.

### Inherited setting

A project setting that follows its company shows the company value in a field-grey box with a 2px ink-3 left rule and the words "Company default" under it, instead of a control. A "Custom" checkbox at the right of the label swaps the box for the normal control, prefilled; unticking it returns the setting to the company. The company page lists the projects that use it and what each customizes, so a change to a default says which projects it reaches before it is saved.
