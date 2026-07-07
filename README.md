# MiTaxi & TaxiMobility documentation website

A fully rewritten, searchable, bilingual (English / Spanish–México) documentation site
covering three source manuals:

- **MiTaxi Driver App Guide** — `site/content/driver.json`
- **MiTaxi Passenger App Guide** — `site/content/passenger.json`
- **TaxiMobility Admin Panel Guide (v9.0)** — `site/content/admin.json`

The content is a complete rewrite of the original PDFs (not a copy/paste extraction),
restructured into a proper navigable, searchable doc site. The original PDFs contained no
usable screenshots — the driver/passenger PDFs had no embedded images at all, and every
screenshot placeholder in the Admin Panel PDF was a broken image link — so this site is
text/table/list based rather than screenshot-based.

The supplied Admin Panel PDF is also physically truncated (it ends mid-sentence in section
12.12 "Manage City", even though its own footer numbering implies more pages follow). Sections
12.13–12.17 (Manage State, Manage Country, Manage Theme Settings, Payments, Cloud Settings)
are present in the site's navigation/table of contents to match the manual, but their pages
say plainly that the source content was not available rather than inventing anything.

## Site design

- Static site, no build step: `site/index.html` + `site/app.js` + `site/styles.css` render
  everything client-side from the three JSON content files.
- Sidebar navigation with a guide switcher (Driver / Passenger / Admin) and a collapsible
  section tree.
- Full-text client-side search (press `/` to focus) across all three guides in the active
  language, with highlighted snippets.
- Language toggle (EN / ES) in the top bar — switches all UI chrome and content instantly.
- Light/dark theme toggle, responsive layout with a mobile nav drawer.

## Run locally

From the project folder:

```bash
cd /Users/nandakumarsomasundaram/Documents/Projects/MITaxi
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000/ in your browser.

## Editing content

Each guide's content lives in `site/content/{driver,passenger,admin}.json` as a recursive
tree of sections. Each node has the shape:

```json
{
  "id": "kebab-case-id",
  "number": "2.1",
  "title": { "en": "...", "es": "..." },
  "content": { "en": "markdown", "es": "markdown" },
  "children": []
}
```

Content markdown supports paragraphs, `- ` bullet lists, `1. ` numbered lists (with indented
sub-bullets nested under a step), `**bold**`, `` `code` ``, `> ` blockquotes/notes, and
GitHub-style pipe tables. No rebuild step is needed — just edit the JSON and refresh.
