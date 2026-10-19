# Vercel web version

This is a Vercel-ready Next.js version of Lens. Matching runs in the browser, so
uploaded text is never sent to a server.

## Features

- **Manual mode**: every field is prefilled with a sensible default (role template,
  job title, seniority, location, job description, must-haves, demo candidates,
  shortlist size). Edit anything; results update instantly.
- **Automated mode**: press **Auto-run all steps** and Lens fills the role brief,
  types the job description, ticks the must-have skills, loads candidates and ranks
  them, showing each step as it goes. Press **Stop** at any time; every field stays
  editable afterwards.
- **Role templates**: Data Analyst, Business Intelligence Analyst, Python Developer,
  Data Engineer and Machine Learning Engineer. Add your own in `lib/templates.ts`.
- **Blind screening**, a strict must-have filter, CSV export, and your last entries
  restored next time you open the page (stored only in your browser).

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Deploy to Vercel

1. Push this project to GitHub.
2. In Vercel, import the repository.
3. Set **Root Directory** to `vercel-app`.
4. Keep the detected Next.js framework settings and deploy.

The web version accepts `.txt` resume exports. PDF extraction remains available in
the original Streamlit application.
