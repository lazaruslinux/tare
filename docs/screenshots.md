# Screenshots for the invite page and About

The pictures the invite page and About show, in one gallery at the end of the story, come
from one manifest, `frontend/src/lib/screenshots.ts`, in the order listed there. Every entry starts with `src: null`, which draws a
frame saying what belongs there instead of a picture. Nothing else has to change when a
real file lands.

## Adding one

1. Save the file as `frontend/public/screenshots/<id>.webp`, using the id below.
2. Set `src: '/screenshots/<id>.webp'` on that entry in the manifest.

## How to shoot them

- Phone shots are 390x844 at 2x, so 780x1688.
- Desktop shots are 1440x900 at 1.5x, so 2160x1350.
- Dark theme, webp quality 82.
- The only display names allowed on screen are "Member 01" and "Member 02".

## The list

- [ ] food-1 (phone): A food page with photo, nutrition facts and ingredients
- [ ] food-2 (phone): Browsing the database with search and the letter strip
- [ ] food-3 (phone): A scanned barcode, prefilled and ready to submit
- [ ] plan-1 (phone): Weight goal with the five rate steps and the review
- [ ] plan-2 (phone): Targets: goal forecast, energy target and macro targets
- [ ] plan-3 (phone): Activity Levels
- [ ] journal-1 (phone): A journal day: four slots, biometrics and the deficit pill
- [ ] journal-2 (phone): The breakdown: macros against targets
- [ ] journal-3 (phone): A run day: the workout row and the adjusted calories
- [ ] fitness-1 (phone): Fitness summary
- [ ] fitness-2 (phone): A workout: the two-lane chart and the route
- [ ] fitness-3 (phone): Device sync setup with the instructions
- [ ] feed-1 (phone): The community feed
- [ ] feed-2 (phone): A member's page with Contributions
- [ ] platform-1 (desktop): Dashboard on a desktop: rail, middle and the feed column
- [ ] platform-2 (phone): Dashboard on a phone
- [ ] platform-3 (phone): The Tare icon on a phone home screen

platform-3 is a real phone home-screen shot, taken by hand on a phone that has the shortcut.
