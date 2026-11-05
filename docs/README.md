# Scribe documentation

This directory builds a static documentation site for Scribe using
[Astro Starlight](https://starlight.astro.build/), independently of the plugin build: it has its
own `package.json`, lockfile, and dependency tree. The configured site URL currently points to
[the upstream documentation](https://docs.obsidiancopilot.com), which describes the upstream
project. A public Scribe documentation address has not been confirmed here.

The guides next to this README are the single source of truth and are never modified to suit this
site. The guides carry no frontmatter and link to each other by filename, so the site adapts them at
build time: `src/docs-loader.mjs` takes each guide's opening level-one heading as its page title, and
`src/remark-published-docs.mjs` removes that heading from the body and rewrites `getting-started.md`
style links to `/getting-started/`. Slugs are the source filenames. Only the Markdown files
directly next to this README are published; `README.md`, `plans/`, and the non-Markdown installers
stay excluded.

## Building

Astro 7 requires Node 22.12 or newer, which is ahead of what the plugin build uses. The `.nvmrc`
pins local development; set the Vercel project's Node.js Version to 22.x so the builds stay
independent.

```sh
npm ci
npm test
npm run build     # emits dist/
npm run preview   # serves the built site
```

## Deployment

Before deploying, confirm a domain you are authorized to use. The site URL and analytics host
checks currently refer to the upstream documentation host; update them to match the confirmed
Scribe address. If using Vercel, create a separate project with these settings:

- **Root Directory:** `docs`
- **Framework Preset:** Astro
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Production Branch:** `main`
- **Node.js Version:** `22.x`

No environment variables are required to build or preview the site.

## Production analytics

Analytics is optional and must remain disabled until the privacy policy is confirmed to cover the
chosen docs domain. The current host check and query below refer to the upstream host; update them
for the confirmed Scribe address before enabling analytics. After that approval, add
`PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` to the Vercel **Production** environment only, using
values from the approved production configuration. Keep their values out of the repository, issue
comments, build logs, and preview environments.

After deploying, visit a few docs pages and run this query in PostHog to confirm that only the
allowlisted events and canonical paths arrive:

```sql
SELECT
  event,
  if(event IN ('$pageview', '$pageleave'), 'allowed', 'unexpected') AS contract_status,
  timestamp,
  properties.$host AS host,
  properties.$pathname AS path,
  properties.$referring_domain AS referring_domain
FROM events
WHERE properties.$host = 'docs.obsidiancopilot.com'
ORDER BY timestamp DESC
LIMIT 100
```

Verify that every row is classified as `allowed`, paths contain no query strings, fragments, search
terms, or ad-click identifiers, and no autocapture or replay events appear. To roll back, remove
both variables from Vercel Production and redeploy; the docs continue to work without analytics.
