# Screenshots for the invite page

Each line is one slide of the invite's slideshow, with its pictures on it, and they come from
one manifest, `frontend/src/lib/screenshots.ts`, whose `line` field says which bullet. About
shows none of them. All eleven in the list below are shot and in place; the calendar shots
under Queued are not, and are not in the manifest yet.

## Adding one

1. Save the file as `frontend/public/screenshots/<id>.webp`, using the id below.
2. Set `src: '/screenshots/<id>.webp'` on that entry in the manifest.

## How to shoot them

- Phone shots are 390x844 at 2x, so 780x1688.
- Desktop shots are 1440x900 at 1.5x, so 2160x1350.
- Dark theme, webp quality 82. Light theme for plan-goal and sync-setup.
- The only display names allowed on screen are "Member 01" and "Member 02".

## The list

- [x] setup-about (line 1, phone): Setup: About you
- [x] setup-activity (line 2, phone): Setup: Activity level
- [x] plan-goal (line 3, phone): Weight goal with the rate steps and the review
- [x] plan-targets (line 3, desktop): Targets: goal forecast, energy target and macro targets
- [x] scan-form (line 4, phone): A scanned barcode, prefilled, with ingredients and vitamins
- [x] journal-day (line 4, desktop): A journal day with the breakdown open
- [x] recipe-page (line 5, phone): A recipe page with photo, parts and Auto-log
- [x] fitness-workout (line 6, phone): A workout: the two-lane chart and the route
- [x] sync-setup (line 6, desktop): Health data sync
- [x] feed-desktop (line 7, desktop): Dashboard on a desktop with the feed column
- [x] member-page (line 7, phone): A member's page with Contributions

## Queued

Not shot, and not in the manifest: the seven lines on the invite say nothing about the
calendar yet, so there is no bullet for these to sit beside. Give them a line first, then
shoot them the way the list above was shot and add them to the manifest.

- [ ] calendar-month (phone): The month with a shared calendar's entries on it
- [ ] calendar-day (phone): One day against the clock, with its blocks
- [ ] calendar-shared (desktop): The month at rail width with the Calendars sheet open
- [ ] calendar-dashboard (desktop): The Dashboard with today's hours and the month beside it
