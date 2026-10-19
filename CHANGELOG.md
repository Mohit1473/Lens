# Change Log

This file records notable project changes. New completed work should be added
under **Unreleased** before sharing or deploying the application.

## Unreleased

### Added

- README: screenshots, How it works, Two ways to use it, and FAQ sections.
- Web app (`vercel-app`): Manual and Automated modes. **Auto-run all steps** picks a
  role template, types the job description, ticks must-haves, loads candidates and
  ranks them, with a live step tracker and a Stop button.
- Web app: role templates (Data Analyst, BI Analyst, Python Developer, Data Engineer,
  ML Engineer) that prefill job title, seniority, location and job description.
- Web app: shortlist-size option, Reset to defaults, and last-used entries restored
  per browser.
- Dashboard-style results page: sidebar inputs, KPI cards, and Overview, Ranking,
  Compare, Candidate profile and Export tabs.
- Charts for score breakdown, score distribution, required-skills matrix, skill gaps
  across the pool, and side-by-side component comparison.
- Styled candidate cards with matched/missing skill chips, must-have badges and a
  per-candidate score-points bar.
- Ranking filters for minimum score, must-haves met, and skill or candidate search.
- Custom colour-blind-validated theme in `.streamlit/config.toml`.
- Explainable PDF decision-report download.
- Mandatory-skill checks with clear review flags.
- Blind-screening mode for anonymised candidate comparison and exports.
- Side-by-side comparison for up to three candidates.
- Candidate evidence view for internships, certifications, and achievements.
- Score breakdown showing skill coverage, keyword coverage, and text similarity.

### Changed

- Web app: new deep navy theme with light result cards.
- Score weights now live in one place (`SCORE_WEIGHTS`) and are shared by the
  scoring code and the charts.
- Requires Streamlit 1.65 or newer and lists Altair explicitly.
- Skill recognition now handles technical context and clause-scoped negation more accurately.
- Negation is now evaluated only before each matched skill within its clause, so a later
  negated skill cannot hide an earlier valid skill.
- Common data-visualisation tools and statistical-testing methods now contribute to
  their broader capability categories.
- PDF and structured candidates now use the same explainable scoring formula:
  65% skill coverage, 20% keyword coverage, and 15% text similarity.
- Structured and PDF candidates now recognise skills from the same candidate-text source.
- README now documents the shared scoring formula, setup on macOS/Linux, privacy
  scope, and known matching limitations.
- The dashboard now includes an explainable recommended-shortlist view that
  prioritises candidates meeting selected must-have skills for human review.
- Added a Vercel-ready Next.js web version with an explainable recommended
  shortlist, browser-local matching, blind-screening labels, and CSV export.
- Renamed the visible application and Vercel web experience to Lens.
- Recruiter controls in the Vercel app now explain how to write a role brief,
  auto-select detected must-haves, and accept additional custom must-have skills.
- Added a recruiter-controlled strict must-have filter that re-filters the
  recommended shortlist and evidence ranking whenever requirements change.
- Simplified the Vercel header to Lens, clarified the five-candidate demo data
  source, and added up to three clearly labelled alternative candidates for review.
- Mandatory-skill options are now detected from the job description.
- Uploaded resumes are processed in a temporary directory and removed after analysis.
- Uploads are limited to 10 MB per PDF.
- Blind screening removes filename identifiers from CSV and PDF exports.
- Common false positives and negated skill statements no longer count as skill evidence.

### Fixed

- Web app: blind-screening labels are now consistent across cards, table and CSV.
- Web app: `.txt` uploads are accepted on Windows even when the browser reports no
  file type, and uploaded resumes keep their file names when blind screening is off.
- Results no longer disappear when filtering, comparing or selecting candidates;
  the analysis is kept in session state until the next run.
- The uploader now shows and enforces the real 10 MB per-PDF limit.
- Reduced false-positive matches for common words such as React, Excel, ML, and API.
- Excel now distinguishes the spreadsheet product from the verb, while still
  recognising clear lowercase technical contexts from extracted PDF text.
- Local archive data and ZIP files are now excluded from version control.
- Structured-data imports now omit sensitive nested fields and redact emails,
  phone numbers, and web links from retained text.
- Privacy filtering now recognises identifying words inside mixed-format field
  names and redacts bare social-profile links.
- Privacy filtering now handles all-caps field names while preserving skill and
  project titles stored in approved object fields.
- Test discovery now works with `python -m unittest` from the project root.
- The optional local archive test skips when the archive dataset is unavailable.
- Unreadable or image-only PDFs show per-file details in the interface.

## Initial version

- Added PDF resume extraction, job-description matching, structured candidate data,
  CSV export, and Streamlit interface.
