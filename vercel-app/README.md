# Vercel web version

This is a Vercel-ready Next.js version of Lens. Matching runs in the browser, so
uploaded text is never sent to a server.

## Features

- **Manual mode**: every field is prefilled with a sensible default (role template,
  job title, seniority, location, job description, must-haves, demo candidates,
  shortlist size). Edit anything; results update instantly.
- **Automated mode**: press **Auto-run all steps** and Lens fills the role brief
  (or keeps your own brief exactly as written), types the job description, ticks the must-have skills, loads candidates and ranks
  them, showing each step as it goes. Press **Stop** at any time; every field stays
  editable afterwards.
- **Evidence panel**: "View evidence" shows the resume with counted skills highlighted,
  the sentence behind each match, and negated mentions ("no Python experience") struck through.
- **Score ring and breakdown**: each card shows the score out of 100 and how many points came
  from skill coverage, keyword coverage and text similarity.
- **Minimum experience**: set "Any" to "10+ years" in step 1. It is prefilled from phrases
  like "3+ years of experience" in the job description, or from the seniority. Each card
  shows the candidate's estimated experience (from job dates and statements; education
  dates are ignored) as meets / below / unclear, and step 4 can filter on it. Experience
  is never added to the match score.
- **Highlights**: awards and recognition, competitions and coding achievements (HackerRank,
  Kaggle, hackathons), certifications and internships are pulled out of each resume and
  shown on the card and in the evidence panel. Shown for review; never added to the score.
- **PDF upload**: PDFs are read in the browser with pdf.js, so files are never sent to a server.
  Scanned (image-only) PDFs are skipped with a message.
- **Write my own role**: the recruiter writes or pastes only the job description, and
  Lens fills the job title, seniority, minimum experience, employment type, location
  and must-have skills from it (`lib/roleInfer.ts`). Auto-filled fields are
  tagged **auto**; any field changed by hand stays as set. A character counter and a
  checklist show what is still missing. **Save as my role** keeps it in this browser for reuse
  (listed under *My saved roles*), and saved roles can be removed at any time.
- **Ready-made roles**: Data Analyst, Business Intelligence Analyst, Python Developer,
  Data Engineer and Machine Learning Engineer. Editing one turns it into your own version.
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

The web version accepts PDF and `.txt` resumes.
