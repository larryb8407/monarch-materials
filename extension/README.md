# Monarch Lead Finder (Chrome extension)

A side panel for desktop Chrome. Open a bid results page, permit search, agenda or news article, press **Scan this page**, and it lists the companies it finds with their phone numbers and flags the kind of job (demolition, paving, concrete, ADA ramps, pipeline, storm drain, grading, bridge, airfield). One click adds a company to the Monarch team list, or adds the new work to a company that's already on it. It shows up in the phone app at the next sync (within a minute, or when the app is reopened).

## Install

1. Download `monarch-lead-finder.zip` from the app's website (the same address as the phone app, with `/monarch-lead-finder.zip` on the end) and unzip it. Or use this `extension` folder from the repo.
2. In Chrome go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `monarch-lead-finder` folder.
4. Pin the extension (puzzle-piece icon → pin), then click its icon to open the side panel.
5. Sign in with the same email and password as the phone app. Only people on the team can sign in.

Chrome asks to "read and change all your data on all websites" because the extension has to read whichever page you scan. It only reads a page when you press Scan, and it only sends what you choose to save, to the Monarch team list.

## Using it

- **Highlight first** on busy pages: select just the bid tabulation, permit table or article text, then scan. Only the highlighted text is read.
- **Job chips** at the top are what it spotted on the page. Tap one to flag or unflag it; the "why call" text and demo score update on every card you haven't edited.
- Each card says **New company** or **Already on the list as ...** (matched by name, then phone, like the daily briefing). Edit anything before saving. **Skip** hides a card.
- **Most important** is ticked for jobs within about 20 miles of the yard or with a high demo score. Those are pinned to the top of Today on the phone.
- **PDFs**: Chrome doesn't let extensions read them. In the PDF press Ctrl+A, Ctrl+C, then **+ Add by hand** → paste → **Find companies in text**.

Check phone numbers before calling: they are taken from the page as-is, and a number printed next to a company is usually, but not always, theirs.

## For developers

Plain JavaScript modules, no build step. `extract.js` is the page parser (`node test.mjs` runs its checks), `cloud.js` talks to the Supabase REST API with the same tables and access rules as the app (`app/supabase/setup.sql`), and `config.js` must match `app/src/config.ts`.

After changing the extension, rebuild the download with:

```sh
./extension/pack.sh
```
