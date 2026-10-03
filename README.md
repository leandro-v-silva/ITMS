# HTML Slide Deck Template

A PowerPoint-style presentation that runs entirely in the browser — one `index.html`, no frameworks, no build step, no dependencies.

## Getting started

Open `index.html` in any browser. That's it.

Or serve it locally (nicer URLs):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

| Key | Action |
| --- | --- |
| `→` `↓` `Space` `PageDown` | Next slide |
| `←` `↑` `PageUp` | Previous slide |
| `Home` / `End` | First / last slide |
| `F` | Toggle fullscreen |
| `N` | Toggle speaker notes |

On-screen arrows, fullscreen and notes buttons also work, and you can swipe on touch screens. The current slide is saved in the URL hash (`index.html#4`), so refreshing or sharing a link keeps your place.

## Editing the deck

Each slide is a `<section class="slide">` inside `<main id="deck">` in `index.html`. To add a slide, copy an existing one and edit the content.

Available layouts:

- `class="slide title"` — big centered title slide
- `class="slide section"` — centered section divider
- `class="slide"` — standard content slide (heading + content)
- `class="slide end"` — closing/thank-you slide
- `<div class="columns">` — two-column layout inside any slide
- `<aside class="notes">` — hidden speaker notes, shown with the `N` key

Theme colors are CSS variables at the top of the `<style>` block (`--bg`, `--accent`, `--accent-2`, …) — change them once to re-skin the whole deck.

## Printing / PDF export

Use the browser's Print function — each slide prints on its own page (landscape orientation recommended).

## Publishing to GitHub

This folder is already a git repository. To publish it:

```bash
# create an empty repo named e.g. "slide_show_git" on github.com, then:
git remote add origin git@github.com:YOUR_USERNAME/slide_show_git.git
git push -u origin main
```

Then enable **GitHub Pages** (Settings → Pages → Deploy from branch → `main` → `/root`) and your deck is live as a website.
