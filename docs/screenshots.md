# Screenshots for the invite page

Each line is one slide of the invite's slideshow, with its pictures on it, and they come from
one manifest, `frontend/src/lib/screenshots.ts`, whose `line` field says which bullet. About
shows none of them. Every entry starts with `src: null`, which draws a frame saying what
belongs there instead of a picture. Nothing else has to change when a real file lands.

## Adding one

1. Save the file as `frontend/public/screenshots/<id>.webp`, using the id below.
2. Set `src: '/screenshots/<id>.webp'` on that entry in the manifest.

## How to shoot them

- Phone shots are 390x844 at 2x, so 780x1688.
- Desktop shots are 1440x900 at 1.5x, so 2160x1350.
- Dark theme, webp quality 82. Light theme for plan-goal and sync-setup.
- The only display names allowed on screen are "Member 01" and "Member 02".

## The list

- [ ] setup-about (line 1, phone): Setup: About you
- [ ] setup-activity (line 2, phone): Setup: Activity level
- [ ] plan-goal (line 3, phone): Weight goal with the rate steps and the review
- [ ] plan-targets (line 3, desktop): Targets: goal forecast, energy target and macro targets
- [ ] scan-form (line 4, phone): A scanned barcode, prefilled, with ingredients and vitamins
- [ ] journal-day (line 4, desktop): A journal day with the breakdown open
- [ ] recipe-page (line 5, phone): A recipe page with photo, parts and Auto-log
- [ ] fitness-workout (line 6, phone): A workout: the two-lane chart and the route
- [ ] sync-setup (line 6, desktop): Health data sync
- [ ] feed-desktop (line 7, desktop): Dashboard on a desktop with the feed column
- [ ] member-page (line 7, phone): A member's page with Contributions
