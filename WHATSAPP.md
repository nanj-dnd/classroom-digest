# WhatsApp delivery

Uses the official WhatsApp Cloud API. No ToS risk, no browser automation,
nothing to keep alive.

## You do NOT need a spare SIM

Meta gives every developer app a **free test phone number** that can send to up
to 5 verified recipients. That is exactly this use case: one sender, one
recipient (you). Messages to test recipients are free.

**Do not register your personal number as the sender.** A number on the Cloud
API can no longer be used in the normal WhatsApp app — you would lose your
personal WhatsApp. Your personal number goes in `WA_TO` as the *recipient*,
which is safe.

## Setup

1. **https://developers.facebook.com/apps** → Create app → type **Business**.
2. Add the **WhatsApp** product. It provisions a test number and a
   **Phone number ID** — that is `WA_PHONE_ID` (a long number, not the phone number).
3. In **API Setup**, under "To", add your own WhatsApp number as a recipient and
   verify the code WhatsApp sends you. Put it in `WA_TO` in **E.164 without the
   `+`**, e.g. `919876543210`.
4. **Create the template.** WhatsApp Manager → Message Templates → Create:
   - Name: `college_digest`
   - Category: **Utility** (not Marketing — Marketing gets throttled and can be
     blocked by the recipient's settings)
   - Language: English (`en`)
   - Body, exactly:

         Good morning. {{1}}

         Classes: {{2}}
         Due: {{3}}
         Also: {{4}}

   - Sample values (Meta requires them to approve):
     `3 open, nothing urgent` / `Mon: MATH-1010 10:00, ECO-1001 13:00` /
     `PS-1 (Calc) Tue 2:00 PM` / `ECO DS Waiting`
   - Submit. Approval is usually minutes for Utility templates.
5. **Get a permanent token.** The token shown in API Setup expires in 24 hours
   and will silently break the cron. Business Settings → System Users → add a
   system user → Generate token → select your app → scopes
   `whatsapp_business_messaging` + `whatsapp_business_management` → no expiry.
   That is `WA_TOKEN`.
6. In `.env`, set `DIGEST_CHANNEL=whatsapp` (or `both`) and fill the WA_ values.

## Test

    node src/index.js digest --dry     # prints the params, sends nothing
    node src/index.js digest           # actually sends

## Constraints worth knowing

- **Templates are mandatory** for scheduled sends. Free-form text is only
  allowed for 24 hours after *you* message the number, which a 07:30 cron
  cannot rely on.
- **Parameters cannot contain newlines, tabs, or 4+ spaces.** `safeParam()` in
  `src/whatsapp.js` strips them; `--dry` warns if any param would be rejected.
- **Changing the template body** requires re-approval. Changing the number of
  variables means updating `whatsappParams()` to match, or Meta returns error
  132000.
- Beyond the 5 free test recipients you would need a real business number and
  Meta business verification. Not needed for a personal digest.

## Error codes the sender decodes

| Code | Meaning |
|---|---|
| 132000 | Parameter count doesn't match the template |
| 132001 | Template name/language not found, or not approved yet |
| 131047 | 24h window closed — must be a template message |
| 190 | Token expired — generate a permanent System User token |
