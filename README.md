# Lens

A Streamlit tool that ranks PDF resumes against a job description, explains every
score, and keeps the final decision with a human reviewer.

- **Dashboard results**: KPI cards, a score-breakdown chart, score distribution,
  a required-skills matrix and a skill-gap chart across the candidate pool.
- **Explainable scores**: every candidate shows matched and missing skills and how
  many points each score component added.
- **Must-have checks**: required skills are detected from the job description;
  missing must-haves are flagged for review, never auto-rejected.
- **Side-by-side comparison** of up to three candidates, plus a candidate profile view.
- **Blind screening** (on by default): names and file names are hidden in results,
  the CSV export and the PDF report.
- **Privacy-sanitised demo dataset** for trying the app without real uploads.

## Setup

### Windows

```bat
py -3.13 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### macOS and Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Run the app

```bat
.venv\Scripts\streamlit run app\app.py
```

On macOS or Linux, run:

```bash
.venv/bin/streamlit run app/app.py
```

## Optional structured portfolio dataset

To add the privacy-sanitized structured demo data (skills, projects,
certifications, internships, and achievements), run:

```bat
.venv\Scripts\python scripts\import_structured_resumes.py
```

On macOS or Linux:

```bash
.venv/bin/python scripts/import_structured_resumes.py
```

The source is the `hehhe89/resumes` dataset on Hugging Face (`master_resumes.jsonl`).
Check the dataset card for its licence before redistributing anything derived from it.

The importer removes recognised contact, location, employer, date, and other
personal-data fields before saving local data. It also redacts common emails,
phone numbers, and web links from retained text.
When the app is hosted without this ignored local file, it downloads and
sanitizes the same approved dataset for the active session.

## Run the tests

From the project root:

```bash
python -m unittest -v
```

The tests need no network access. One optional test is skipped when the local
`data/archive/` dataset is not present.

## How scoring works

This app supports human review; it does not make automated hiring decisions.

When the job description contains recognised catalogue skills, every candidate
is scored with the same formula:

- 65% skill coverage — recognised job skills found in candidate text.
- 20% keyword coverage — meaningful job-description words also found in the text.
- 15% TF-IDF text similarity — overall similarity between the resume and job description.

When no catalogue skills are found in the job description, the fallback score is
75% keyword coverage and 25% TF-IDF text similarity. The score breakdown is
shown in the app so reviewers can inspect the inputs rather than treating the
ranking as a decision.

## Known limitations

- Literal keyword coverage and TF-IDF similarity can reward keyword stuffing. In
  one probe, a bare keyword list scored 83.8 while a real analyst profile scored
  72.9. A labelled evaluation set is needed before tuning the weights further.
- Skill recognition is a fixed catalogue of roughly 20 skills, not a complete
  understanding of a resume. Related wording outside its patterns can be missed.
- To avoid wrongly hiding real skills, commas and `and` start a new negation
  clause. For example, “No experience with Python, SQL or Tableau” can still
  credit SQL and Tableau.
- Lowercase `excel` without nearby spreadsheet context can be missed.
- Large numbers such as `1200000` can be conservatively redacted as phone-like
  numbers.
- Structured demo data is privacy-reduced, not anonymous: names or employers
  written inside arbitrary free text cannot be removed reliably.
- Scanned or image-only PDFs need OCR before their text can be analysed.
- Blind screening hides candidate and file identifiers in results, but resume
  text can still contain protected attributes or other bias-relevant signals.

## Project layout

- `app/` — Streamlit dashboard (sidebar inputs, KPI cards, tabbed results, charts).
- `.streamlit/config.toml` — app theme and the 10 MB upload limit.
- `src/` — reusable extraction, skill detection, scoring and report code.
- `scripts/` — structured-dataset import and privacy sanitisation.
- `tests/` — unit tests (`python -m unittest`).
- `data/structured/` — privacy-sanitized structured portfolio dataset used by the app.
- `data/` — sample PDF and optional legacy PDF archive retained locally for extraction tests.
- `notebooks/` — exploratory analysis.
- `CHANGELOG.md` — completed features, fixes, and dependency changes.
