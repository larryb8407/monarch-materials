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

- **Transcription** uses Chrome's speech recognition on the mic. Put the call on speaker and tap Transcribe. Android may pause the mic while the dialer is in front. Samsung's built-in call recording and transcripts are the reliable backup.
- **Daily briefing**: "Ask Claude for today's briefing" opens Claude with a prompt that returns CSV. Paste or upload it; companies are matched by name, new ones are added, and top-priority ones are pinned to the top of the queue with a "New top lead" tag until they're called. Only CSV is accepted here (the design's free-text AI parsing and AI call summaries relied on the Claude Design runtime, which isn't available on the phone). Call summaries use the built-in key-line extractor.
- **Automatic morning briefing**: a scheduled Claude run writes `app/public/briefing.csv` (same CSV format) and pushes it to `main`; Netlify publishes it. Each time the app comes to the front it fetches `briefing.csv` (never cached). If the file is new, Today shows a "New briefing ready" card that opens the usual review step. Once the briefing is added (or found to have nothing new), it isn't offered again.
