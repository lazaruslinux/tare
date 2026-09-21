# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an invited adult who has never tracked anything: no calorie counting, no exercise on a schedule, no familiarity with nutrition terms. They arrive through a friend's invite link, mostly on a phone, and the app has to feel effortless and never condescending. Every design decision is weighed against this person first.

The second audience is the kitchen-scale tracker who weighs everything and wants grams and ounces, density and per-serving detail. They are served by a one-tap path rather than by making the default surfaces denser.

Two further roles exist inside the same account type: a reviewer, who works the approval queue, and an administrator, who also mints invites, manages members and roles, and matches vitamins and minerals for approved foods. There are no other account types.

Everyone is 18 or over. Birthdate is required at registration and the age gate is enforced server-side.

## Product Purpose

Tare is a self-hosted food journal and health tracker for a small invited group. It logs food, weight and body measurements, exercise and the step and workout data a phone sends in, works out calorie and macro targets from a weight goal, keeps a calendar beside the journal, and shows a read-only feed of what chosen friends have logged.

Success after a year of use, in the order that matters:

1. Members still log most days. Logging a day is quick enough that the habit holds, and every other choice serves this.
2. The shared food database covers what the group eats, so the online barcode lookup fires rarely.
3. Members reach the goals they set.
4. The group uses it together: friends, the feed and shared calendars keep people in.

## Positioning

The food database starts completely empty and is built by the members. Every food in it was entered by a member and checked by a person before it was published, so the database grows more useful the longer an instance runs and the less it resembles a generic product catalogue.

There is no online free-text food search and there never will be. Text search hits only the approved database plus the member's own private foods. Scanning a barcode is the only online step a member sets off; what comes back waits in the approval queue and, once approved, is served from the instance forever. The one other lookup belongs to an administrator matching vitamins and minerals for an already approved food.

Approved foods are community-owned truth: they never refetch, and corrections arrive only as edit proposals through the same queue. Approved edits never alter existing diary entries.

## Operating Context

- Installed as a PWA on a phone; the phone is where most logging happens, often in a kitchen with the food in hand or a scale on the counter. Desktop gets a left rail and a right column with a Today so far strip and the community feed.
- Accounts are invite-only. The first account is made from a shell; every other member claims an invite link carrying one to ten seats, confirms an email address, then passes a short setup (sex, height, weight, optional city and state, activity level) and a welcome tour. Targets are computed automatically from that point.
- The daily loop: open the Journal for the day, add food by scanning a barcode, picking from own foods, meals, recipes or repeat items, or browsing the shared database by aisle; record a weigh-in or measurements; mark the day complete.
- Contribution loop: a scan or a new food is corrected on an editable form, then submitted to the queue. The submitter logs it privately while it waits. A community submission of a packaged food needs the full ten-field nutrition panel and two photos, front of pack and nutrition label; a whole food needs one photo; a private custom food needs calories, protein, carbs and fat and no photo.
- Review loop: reviewers and administrators work the queue of new foods, edits and photos, with every decision written to a review log. Members can report anything wrong with a food.
- Health data arrives from Health Auto Export on Apple or a Health Connect webhook on Android through one endpoint with per-member tokens, or as an uploaded file. Workouts arrive with routes and an optional map.
- The calendar holds appointments, timed or all-day, spanning days, repeating by week, month or year, read as a month grid, a single day against the clock, or today's hours on the Dashboard. Calendars and single appointments can be shared with friends by invitation. A change to a shared calendar and an invitation reach a member's devices as notifications where the instance holds push keys, and a timed appointment reminds its member fifteen or thirty minutes before it starts, a switch of its own.
- A library of stretches and moves, member profiles with avatars, friends by mutual request, a sharing switch over every part of the feed, and a feedback line to the administrator sit beside the core loops.
- Instances run on one machine behind loopback and a reverse proxy; the reference instance is private to its group. Time zones are the seven US zones.

## Capabilities and Constraints

Built and running (version 0.8.2): invites with seats, email verification, setup and welcome tour, the journal with custom foods, meals, recipes, daily foods and day completion, the shared database browsed by aisle or found by camera barcode, label and front photos, food reports, the two-role approval queue and review log, vitamins and minerals per serving with an administrator's USDA match picker, weight goal with rate steps and forecast, weigh-ins and bioimpedance measurements, health sync and workouts with routes, the calendar with shared calendars and appointment invitations, stretches and moves, profiles, friends, the read-only feed with sharing toggles on the account and on each workout, feedback to the administrator, admin screens for invites, members, roles, uploads and micro matches, PWA install with a reload bar, web push notifications (a morning check-in carrying the budget, the weigh-in ask and the first appointment of the day, an evening check-in, a weekly check-in when the journal has gone quiet, a weekly Biometrics nudge on a chosen weekday, reminders fifteen or thirty minutes before a timed appointment, and everything that moves on a shared calendar) with a switch per kind and a device list under More, then Notifications.

Deliberately absent, and not to be designed toward: medals, experience points, streak badges, likes, comments, fasting, water, online free-text food search, kid accounts, shared goals, a companion app.

Decided product facts to preserve:

- Tare is a browser app installed as a PWA, rich on desktop as well as on a phone, and has no native iOS or Android app by choice: building one is more work than the owner wants to take on now. A browser cannot read a phone's health store, so health data reaches Tare only through Health Auto Export on Apple, a Health Connect webhook on Android, or an uploaded file. The sync setup wizard and the Guide exist to make that hand-off workable and are the cost of staying browser-based, not an extra layer.
- Auto targets by default, computed silently from the profile; a member who skips the profile runs on fixed guideline defaults at 2,000 kcal until they add details.
- Portion entry defaults to the label serving; one tap on Weigh it flips to grams or ounces and the mode is remembered per food.
- The only facts a member can make visible to other members are age in years, sex, and city and state, each behind its own opt-in toggle, all off by default. Birthdate, height, weight, measurements, targets, food and goals are private to the member and never visible to other members or administrators.
- Food, weight and steps never appear in the feed; a workout carries its own sharing, stamped from the account's switches when it syncs and changed one session at a time afterwards, and route ends are trimmed automatically. The feed shows only what was shared, to its owner as much as to anybody else.
- One public front photo per food; the label photo is verification-only and never served to members.
- Goal direction is derived from goal weight against the latest weigh-in; there is no separate goal setting.
- Every number Tare computes follows the specification in docs/HEALTH-MATH.md, sourced to the Dietary Guidelines for Americans and the American Heart Association. Tare does not give medical advice and says so.
- Registration, login and other endpoints are rate limited; nothing enters the database without a person deciding it should; nothing beyond the barcode lookup and the administrator's USDA match leaves the server.

Terminology, in the words the interface uses: member, administrator, reviewer, invite, Journal, Dashboard, Food, More, Targets, Weight goal, Activity level, Biometrics (the copy word for weigh-ins and body measurements), Gender (the label for the sex field; the API field stays sex), Weigh it, Scanned / created foods, meals, recipes, repeat items, aisle, review queue, review log, friends, feed, calendar, appointment, shared calendar, Moves. Protein, Carbs and Fat are spelled out. Words that never appear in the interface: TDEE, BMR, MET, AMDR, macros as jargon, formula names, with a single allowance for "sometimes called basal metabolic rate" on the At rest card.

Technical: FastAPI, SQLAlchemy 2, Alembic and Postgres 16 behind React 19, Vite, TypeScript, Tailwind v4 and framer-motion, shipped with Docker Compose. Backend runtime dependencies are the eleven named in requirements.in; frontend runtime dependencies are react, react-dom, framer-motion, lucide-react and zxing-wasm plus the map stack for workout routes. Nothing new without cause. The scanner runs zxing-wasm under a content security policy that allows wasm-unsafe-eval; that is settled.

Open product facts: push exists, and so do reminders before a timed appointment; scale sync is post-1.0; account deletion and data export are queued as a round; public or LAN exposure of any instance is a separate decision for its operator.

## Brand Commitments

- Name: Tare, written with a capital T in the wordmark and in all product copy (the owner's pick, 2026-09-06), the kitchen-scale button every food logger presses. Wordmark set in Righteous; body in Figtree Variable. Both are binding and a change to either is a question, never a design call.
- Two themes: dark is the default on the bare root, a graphite ground with warm off-white text and one sage-green accent; light is an oat paper ground with warm grey text and a forest-green accent. The neutrals carry no green (the 2026-09-15 quieter pass); the accent is kept for the wordmark, the primary action, the active tab, switches and data fills. Keep the identity; a full palette swap is a question first.
- Voice: plain words for people who have never tracked anything, one-sentence empty states with one action, undo snackbars instead of confirm dialogs, no exclamation marks, no emojis, no em dashes anywhere in copy, comments or docs.
- The AI disclosure appears once in the README and nowhere else. Open source under AGPL-3.0-or-later, free forever, never sold and never offered as a hosted tier.

## Evidence on Hand

- Eleven real screenshots of the running app in frontend/public/screenshots, listed with their shot recipe in docs/screenshots.md; calendar shots are queued and not yet taken.
- docs/HEALTH-MATH.md, the sourced specification for every computed number; docs/STRETCHES.md, the stretch and move library with its sources; docs/INGEST.md and docs/DEPLOY.md.
- Data sources: Open Food Facts under the ODbL for barcode lookups, USDA FoodData Central in the public domain for vitamins and minerals.
- No testimonials, member counts, case studies or press exist and none may be invented. The instance that runs today serves a small private group whose data is not evidence.

## Product Principles

1. The empty database is the product. Everything that grows it, scanning, correcting, submitting, reviewing, has to be short and satisfying, and nothing may route around the queue.
2. Effortless for the person who has never tracked. Sensible defaults computed silently, plain words, progressive disclosure: the novice sees calories left and a scan button, the detail folds away for the tracker who wants it.
3. Private by default, shared by explicit choice. Every fact is the member's alone until they flip a toggle, and the toggles are few, named plainly and off.
4. Numbers with sources, no advice. Every figure traces to the health math document; the interface estimates and says so, and never diagnoses or prescribes.
5. Nothing that gamifies. No streaks, medals, points, likes or nudges; the reward is the log itself and the friends who see the workout.

## Accessibility & Inclusion

Adults only, 18 and over, enforced at registration. Form controls are never under 16px so iOS Safari does not zoom on focus; tap targets are 44px; motion is 0.18s with reduced-motion substitutes rather than removals. No further product-specific accessibility requirement has been established.
