# classroom-digest

A college tracker for anyone whose courses run on Google Classroom.

One email each morning: what's overdue, what's due, what professors posted that
you haven't seen. Deadlines pushed to a "College" calendar. Assignment briefs
and attachments pulled to disk so you can actually work on them locally.

## Setup

### 1. Google Cloud OAuth client (yours to do — ~10 min)

1. https://console.cloud.google.com/ → new project, call it anything.
2. **APIs & Services → Library** → enable: **Google Classroom API**,
   **Google Drive API**, **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External → fill the required
   fields → under **Test users**, add the Google account your Classroom is on
   (usually your college address).
4. **Credentials → Create credentials → OAuth client ID → Desktop app** →
   download the JSON and save it here as `credentials.json`
   (or run `node src/index.js adopt` to find it in ~/Downloads for you).

> **Testing status expires refresh tokens every 7 days.** The tool fails loudly
> when that happens — rerun `npm run auth`. To stop it, publish the consent
> screen to Production (self-verification is fine for a personal-use app that
> only you sign into).

### 2. Config

    cp .env.example .env

Fill in `DIGEST_TO`, `RESEND_API_KEY` and `DIGEST_FROM` (a verified Resend domain).
Set `EXCLUDE_COURSES` to last semester's name: Classroom leaves old courses
marked active.
For WhatsApp delivery set `DIGEST_CHANNEL=whatsapp` and see [WHATSAPP.md](WHATSAPP.md).
Set `SYNC_DRIVE=false` or `SYNC_CALENDAR=false` to drop those scopes.

### 3. Your term (optional, but this is what makes it good)

Classroom knows assignments. It doesn't know your timetable, your exam dates or
what your courses actually are. Three hand-kept files fill that in:

    cp timetable.example.json timetable.json   # when and where classes meet
    cp syllabus.example.json  syllabus.json    # term dates, breaks, exams, weekly topics
    cp aliases.example.json   aliases.json     # "ECO-1001" -> what you call it

Every field is optional, and the tool runs fine with none of them. All three are
gitignored, so your data stays out of the repo. Update them each semester; the
digest warns you once the exam period has passed.

`node src/index.js timetable <saved-page.html>` parses a saved registration page
into `timetable.json`. It was written for one college's portal (it finds the
table by its header text), so on yours it may need a tweak in `src/ams.js`.

### 4. Authorize and test

    node src/index.js doctor           # what's missing, before you auth
    npm run auth
    node src/index.js doctor           # verifies each scope group separately
    node src/index.js digest --dry     # prints to terminal, writes data/preview.html, sends nothing

### 5. Schedule it (macOS)

    ./install-schedule.sh              # daily at 22:00 via launchd

On Linux, a cron line does the same job:
`0 22 * * * cd /path/to/classroom-digest && node src/index.js digest`.

## What runs by itself

A launchd agent (`com.classroom-digest`) runs nightly at 22:00 and does the
whole chain unattended:

1. pulls Classroom — courses, coursework, your submissions, announcements
2. downloads new briefs, readings and attachments; OCRs scans; flags AI-prohibited work
3. updates the College calendar and clears events for anything you turned in
4. emails the digest, describing **tomorrow** (evening mode)
5. rebuilds the dashboard, and redeploys it if `AUTO_DEPLOY=true` (see [web/README.md](web/README.md))

If any step throws, it emails a failure notice with the stack and the likely cause,
rather than dying quietly. Logs: `data/digest.log`, `data/digest.err.log`.

## Commands

| Command | Does |
|---|---|
| `node src/index.js doctor` | Check credentials, token, and every scope group one by one |
| `npm run auth` | Run the OAuth flow, store `data/token.json` |
| `node src/index.js dump` | Write raw API responses to `data/raw-shapes.json` |
| `node src/index.js timetable <file.html>` | Parse a saved registration page into `timetable.json` |
| `node src/index.js find <text>` | Search every synced brief and reading |
| `node src/index.js requisites` | Grading weights, attendance rules and standing requirements per course |
| `node src/index.js sync` | Pull data, sync Drive + Calendar, no email |
| `node src/index.js digest --dry` | Full run, preview only, nothing sent, nothing marked seen |
| `node src/index.js digest` | Full run and send |

## If your college's admin blocks the app

Education Workspace tenants can restrict third-party OAuth apps. Symptoms:
`admin_policy_enforced` or `access_denied` at the consent screen.

- `drive.readonly` is a **restricted** scope and the likeliest to be blocked.
  Set `SYNC_DRIVE=false` and retry — deadlines, submissions, announcements and
  calendar all still work without it.
- If even the Classroom scopes are blocked, ask IT to allowlist your client ID.
  Failing that, the fallback is a logged-in-browser scrape, which is worse.

## Layout

    src/auth.js       OAuth, scope groups, loud token-expiry failure
    src/classroom.js  Courses, coursework, own submissions, announcements
    src/triage.js     Outstanding-work ranking into overdue/today/soon/week
    src/drive.js      brief.md + attachments → courses/<course>/<assignment>/
    src/calendar.js   Upsert deadlines to a dedicated calendar, clear when done
    src/schedule.js   timetable.json -> today's / next classes
    src/syllabus.js   syllabus.json -> this week's topics, readings, exams
    src/digest.js     HTML + text rendering
    src/deadlines.js  Deadlines buried in announcement prose (candidates, not facts)
    src/mail.js       Resend send (checks `error`, which does not throw)
    data/             tokens, state, snapshot, logs — gitignored
    courses/          synced briefs and readings — gitignored
    web/              Optional private dashboard on Vercel, behind email OTP

## AI-prohibited assignments

If an assignment's files say AI use is not allowed, sync writes
`DO-NOT-FEED-TO-AI.md` into its folder and the digest and dashboard flag it.
That's a reminder for you, not an enforcement mechanism.

## License

MIT
