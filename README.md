# slide_show_git

Two projects in one repo:

1. **ITSM BI report** (`etl/` + `report/`) — a mini BI stack: Python/pandas ETL over the
   [Kaggle ITSM dataset](https://www.kaggle.com/datasets/ahanwadi/itsm-data), visualized with
   D3.js and published to **GitHub Pages** via CI/CD (GitHub Actions).
2. **Slide deck template** (`index.html` at the repo root) — a PowerPoint-style HTML template
   (arrow-key navigation, speaker notes, print support). It lives in the repo but is *not*
   part of the Pages site.

## Architecture

```
data/raw/ITSM_data.csv   raw dataset (committed for reproducibility)
        │
        ▼
etl/  extract.py   → obtains the CSV (local file, or Kaggle API if missing + creds set)
      transform.py → cleans & aggregates (pandas)
      load.py      → writes report/data/*.json
      pipeline.py  → orchestrates the three stages + validation gate
        │
        ▼
report/  index.html + charts.js (D3.js v7, vendored) + data/*.json
        │
        ▼
.github/workflows/bi-cicd.yml  → runs ETL on every push, validates, deploys report/ to Pages
```

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r etl/requirements.txt

python etl/pipeline.py            # extract → transform → load

cd report && python3 -m http.server 8000
# open http://localhost:8000      (a server is needed: the report fetches JSON)
```

The report is **bilingual (EN ⇄ PT-BR)**: use the EN/PT switch in the header —
the choice is remembered in `localStorage`. All strings live in `report/i18n.js`.

## CI/CD

The workflow `.github/workflows/bi-cicd.yml` runs on every push to `main` (when ETL/data/report
files change), on manual dispatch, and monthly:

1. **ETL job** — installs pandas, runs `etl/pipeline.py`, validates that all report JSON files
   exist and are non-empty, uploads `report/` as a Pages artifact.
2. **Deploy job** — publishes the artifact to GitHub Pages.

**One-time GitHub setup:** repo *Settings → Pages → Source: GitHub Actions*. The workflow uses
the default `GITHUB_TOKEN`, so no personal access token is needed. The raw CSV is committed, so
no Kaggle credentials are required either; if you ever delete `data/raw/` and want CI to pull a
fresh copy from Kaggle, add `KAGGLE_USERNAME` and `KAGGLE_KEY` as repository secrets —
`etl/extract.py` picks them up automatically.

## Data notes (what the ETL handles for you)

- Timestamps come in **two day-first formats** (`D/M/YYYY H:MM` and `DD-MM-YYYY H:MM`);
  both are normalised with `format="mixed", dayfirst=True` (0 negative durations).
- Priority/Impact/Urgency run **1–5** (5 = very low); `NS` impact marks unknown priority.
- `Handle_Time_hrs` uses an unreliable digit-grouping format, so resolution time is
  **recomputed** from `Open_Time` / `Resolved_Time`.
- **ITIL measures** (`report/data/itil.json`): MTTR (mean hours Open→Resolved),
  MTBF (mean days between incidents on the same CI), First Contact Resolution
  (% of resolved tickets never reassigned — proxy), escalation rate (% reassigned 2+),
  SLA compliance, reopen rate, major-incident (P1+P2) count and open backlog.
  MTBF is biased by the volume ramp in this extract — treat as indicative.
- **SLA targets are an assumption**, documented here and in the report: P1 ≤ 1d, P2 ≤ 3d,
  P3 ≤ 7d, P4/P5 ≤ 14d.
- The source extract only has resolution timestamps from Oct 2013 onward — earlier months
  legitimately show zero resolutions.

## License note

The Kaggle dataset lists its license as *Unknown*. The raw CSV is kept in this repo for
pipeline reproducibility; if you publish the repo publicly, verify the dataset terms first.

---

## Slide deck template (repo root `index.html`)

A self-contained HTML presentation: open it directly in a browser. Controls: `←` `→` navigate,
`F` fullscreen, `N` speaker notes; swipe works on touch screens; browser Print exports each
slide to its own page. Slides are `<section class="slide">` elements; theme colors are CSS
variables at the top of the `<style>` block. Details were in the original README of that file.
