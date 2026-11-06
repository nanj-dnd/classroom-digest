# College dashboard (web)

A **static snapshot**. The deployed site never calls the Google Classroom API —
`node src/index.js digest` on your Mac bakes the data into `api/_payload.js`
during the 22:00 run. Your Google refresh token never leaves your laptop.

## Access: email OTP

- `/` is the login page. It asks Resend to email a 6-digit code.
- `/api/verify-otp` checks it and sets a signed session cookie (30 days).
- `/api/dashboard` returns the dashboard only with a valid session.

The coursework is served **through a function**, never as a static file, so an
unauthenticated request never receives it. The code is only ever emailed to the
one address in `ALLOWED_EMAIL` — there is no "enter your email" field, so nobody
else can trigger a code to themselves.

Auth is stateless: HMAC-signed cookies, no database. Codes expire in 10 minutes,
requests are rate-limited to one per 30 seconds per IP, and comparison is
constant-time.

## Deploy

    cd web
    npx vercel            # first run links the project
    npx vercel --prod

Environment variables (Vercel dashboard → Settings → Environment Variables):

| Var | Value |
|---|---|
| `AUTH_SECRET` | long random string — `openssl rand -hex 32` |
| `RESEND_API_KEY` | same key as the digest |
| `DIGEST_FROM` | `College <college@yourdomain.com>` |
| `ALLOWED_EMAIL` | the only address that can receive a code |

Then point the domain at this project in Vercel → Settings → Domains.

## Local preview

`public/preview.html` is an unauthenticated copy for checking the design.
It is listed in `.vercelignore` and is never deployed.

    node web/serve.js     # http://localhost:4173/preview.html

## Redeploy after a data refresh

`node src/index.js digest` regenerates `api/_payload.js`, but that only reaches
the site on the next deploy:

    cd web && vercel --prod --yes

Set `AUTO_DEPLOY=true` in the root `.env` and the nightly run does this for you.
