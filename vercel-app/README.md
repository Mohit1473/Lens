# Vercel web version

This is a Vercel-ready Next.js conversion of Lens. It keeps
matching in the browser for the demo flow, so uploaded text is not sent to a
server.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push this project to GitHub.
2. In Vercel, import the repository.
3. Set **Root Directory** to `vercel-app`.
4. Keep the detected Next.js framework settings and deploy.

The current Vercel version accepts `.txt` resume exports. PDF extraction remains
available in the original Streamlit application and can be added to this web
version with a dedicated PDF parsing API in a later iteration.
