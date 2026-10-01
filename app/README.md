# Monarch Materials app

A prospect-calling app for Monarch Materials, built from the Claude Design handoff in `../project/Monarch Materials.dc.html`. It installs on Android (Galaxy S25) as a home-screen app and works offline once loaded.

Screens: Today (call queue, daily briefing), Prospects (search, filters, add), prospect detail (why call, notes, call history with transcripts), live call with transcription, call wrap-up (outcome, follow-up, dictated notes, summary), Call log, and Drive Mode (big CALL button, skip/back, voice commands "call", "next", "back", "exit").

The 177 prospects from `project/prospects.json` ship in the app (`src/prospects.json`) and are copied to the phone's storage on first launch. After that, everything (calls, transcripts, edits, briefing updates) is stored in Chrome on the phone under `monarch-prospects-v2`, so clearing Chrome's site data erases it.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173, also on your LAN
npm run build    # typecheck + production build into dist/
npm run preview  # serve dist/
```

On a desktop browser, tapping Call plays a scripted demo conversation instead of dialing. Toggle this and Drive Mode's auto-advance with `DEMO_TRANSCRIPT` / `DRIVE_AUTO_NEXT` in `src/lib.ts`.

## Put it on the phone

1. `npm run build`
2. Drag the `dist/` folder onto https://app.netlify.com/drop (or any HTTPS static host). HTTPS is required for the microphone and for installing.
3. Open the URL in Chrome on the S25 → ⋮ → **Add to Home screen** (or **Install app**).

## Notes

- **Calls**: tapping CALL opens the phone dialer and a simple on-call screen; End call goes to the wrap-up (outcome, follow-up, notes with optional voice dictation). Call transcription was removed.
- **Daily briefing**: "Ask Claude for today's briefing" opens Claude with a prompt that returns CSV. Paste or upload it; companies are matched by name, new ones are added, and top-priority ones are pinned to the top of the queue with a "New top lead" tag until they're called. Only CSV is accepted here (the design's free-text AI parsing and AI call summaries relied on the Claude Design runtime, which isn't available on the phone). 
- **Automatic morning briefing**: a scheduled Claude run writes `app/public/briefing.csv` (same CSV format) and pushes it to `main`; Netlify publishes it. Each time the app comes to the front it fetches `briefing.csv` (never cached). If the file is new, Today shows a "New briefing ready" card that opens the usual review step. Once the briefing is added (or found to have nothing new), it isn't offered again.

## Team mode (shared list with sign-in)

With `src/config.ts` empty the app runs on one phone with no sign-in. To share one list with employees:

1. Create a free project at https://supabase.com.
2. SQL Editor → New query → paste `supabase/setup.sql` → Run. It creates the tables, access rules, and adds the owner (larryb8407@gmail.com).
3. Authentication → Sign In / Providers → Email: turn **off** "Confirm email" (only emails on the team list can sign up anyway).
4. Project Settings → API: put the Project URL and the `anon` public key into `src/config.ts`, commit, push.

How it works:
- Only emails in the `team` table can create an account or read anything. The owner adds/removes people under the name menu (top right) → Team; removal cuts access immediately.
- Everyone sees and can add/edit all prospects and all calls; each call records who made it. Only the owner sees the daily briefing / Update list.
- Every change is saved on the phone first and queued (`monarch-outbox`), then uploaded when there is signal. The header shows "N unsent" while changes are waiting.
- On the owner's first sign-in, if the team list is empty, the list on that phone (with its call history) is uploaded as the starting team list.
- Each person's drive route and the owner's private ★ priority list are saved in their own `user_state` row (nobody else can read it).
- To avoid double calls: tapping CALL marks the prospect "<name> calling…" for everyone (30 min, cleared on save/discard); anything called in the last 7 days leaves everyone's queue until its follow-up date; calling a prospect someone else reached recently asks first. Changes arrive live via Supabase Realtime (setup.sql adds the tables to the publication), with a 20-second refresh as backup.
- Prospect page → "Update status, follow-up or notes" changes those without logging a call.

## Lead Finder (Chrome extension)

`../extension` is a desktop Chrome side panel that pulls company names and phone numbers from bid, permit and news pages and saves them to the team list. Install steps are in `extension/README.md`; the site serves a download at `/monarch-lead-finder.zip` (rebuild it with `extension/pack.sh`).
