# classroom-digest

A college tracker for anyone whose courses run on Google Classroom.

Sign in with Google and see what's overdue, what's due and what professors
posted that you haven't seen. Briefs, slides and readings are pulled to disk,
deadlines go to a "College" calendar, and three buttons help you study:
**prepare me for a test**, **quiz me on this file**, **help me with this
assignment**.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer. Then:

    git clone https://github.com/nanj-dnd/classroom-digest.git
    cd classroom-digest
    npm install
    npm start

Your browser opens. Click **Sign in with Google** with the account your
Classroom is on, and your courses sync. That's the whole setup. Everything runs
on your computer; the Google sign-in, your files and your Claude key stay in
this folder.

Google will say the app **isn't verified** (it hasn't been through Google's
review yet). Click **Advanced**, then the **Go to …** link. Until it's verified,
Google caps the shared sign-in at 100 users; past that, use your own client
(below).

## Study buttons

Paste a [Claude API key](https://console.anthropic.com/settings/keys) into
**Settings** and three buttons appear:

- **Prepare me for a test**, on each course: finds the next test from the
  syllabus and announcements, ranks the topics, builds a day-by-day plan, then
  quizzes you and sets fresh practice in the style of any past papers.
- **Quiz me**, on every synced file: one question at a time, marked and
  explained, harder as you go. Say "slide 12" to focus on one part. Slides go to
  Claude as the actual PDF, so diagrams and scanned pages work.
- **Help me with this**, on each assignment: explains the ideas, points to where
  your course files teach them, breaks the task into steps and gives feedback on
  your own drafts. It won't write the assignment for you.

You pay Anthropic directly for what you use. The course files are cached
between messages, so follow-ups cost a fraction of the first one. Set
`CLAUDE_MODEL` in `.env` to use a different model.

**AI-prohibited work stays off limits.** If an assignment's files say AI may
not be used, the buttons disappear for every assignment in that course, its
files are never sent to Claude, and the server refuses even if asked directly.

## Nightly email digest (optional)

The same sync can email you a digest every night and push deadlines to a
"College" calendar without the app open.

### Config

    cp .env.example .env

Fill in `DIGEST_TO`, `RESEND_API_KEY` and `DIGEST_FROM` (a verified Resend domain).
Set `EXCLUDE_COURSES` to last semester's name: Classroom leaves old courses
marked active.
For WhatsApp delivery set `DIGEST_CHANNEL=whatsapp` and see [WHATSAPP.md](WHATSAPP.md).
Set `SYNC_DRIVE=false` or `SYNC_CALENDAR=false` to drop those scopes.

### Your term (optional, but this is what makes it good)

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

### Test it

    node src/index.js doctor           # checks the sign-in and each permission
    node src/index.js digest --dry     # prints to terminal, writes data/preview.html, sends nothing

### Schedule it (macOS)

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
| `npm start` | The local app: sign-in, dashboard, study buttons |
| `node src/index.js doctor` | Check credentials, token, and every scope group one by one |
| `npm run auth` | Run the OAuth flow, store `data/token.json` |
| `node src/index.js dump` | Write raw API responses to `data/raw-shapes.json` |
| `node src/index.js timetable <file.html>` | Parse a saved registration page into `timetable.json` |
| `node src/index.js find <text>` | Search every synced brief and reading |
| `node src/index.js requisites` | Grading weights, attendance rules and standing requirements per course |
| `node src/index.js sync` | Pull data, sync Drive + Calendar, no email |
| `node src/index.js digest --dry` | Full run, preview only, nothing sent, nothing marked seen |
| `node src/index.js digest` | Full run and send |

## Using your own Google client

The repo ships a shared sign-in (`oauth-client.json`). To use your own instead,
for example past the 100-user cap or if your college blocks the shared one:

1. https://console.cloud.google.com/ → new project, call it anything.
2. **APIs & Services → Library** → enable **Google Classroom API**,
   **Google Drive API** and **Google Calendar API**.
3. **OAuth consent screen** → External → fill the required fields → add the
   Google account your Classroom is on under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app** →
   download the JSON and run `node src/index.js adopt` to move it into place
   as `credentials.json`, which takes precedence over the shared one.

> While the consent screen is in **Testing**, Google expires sign-ins every 7
> days. Publishing it to Production stops that.

## If your college's admin blocks the app

Education Workspace tenants can restrict third-party OAuth apps. Symptoms:
`admin_policy_enforced` or `access_denied` at the consent screen.

- `drive.readonly` is a **restricted** scope and the likeliest to be blocked.
  Set `SYNC_DRIVE=false` and retry — deadlines, submissions, announcements and
  calendar all still work without it.
- If even the Classroom scopes are blocked, ask IT to allowlist the client ID
  (in `oauth-client.json`, or your own).
  Failing that, the fallback is a logged-in-browser scrape, which is worse.

## Layout

    src/app.js        The local app server (npm start)
    src/tutor.js      Study buttons: picks the course files, streams Claude's reply
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
    web/template.html The dashboard, shared by the app and the hosted snapshot
    web/app/          The app's welcome page, toolbar and tutor drawer
    web/              Optional private dashboard on Vercel, behind email OTP

## AI-prohibited assignments

If an assignment's files say AI use is not allowed, sync writes
`DO-NOT-FEED-TO-AI.md` into its folder, the digest and dashboard flag it, and
the study buttons stay off for that course's assignments. Detection reads the
files' wording, so it can miss a rule that's only stated in class: check your
course's policy yourself.

## License

MIT
