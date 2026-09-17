# Changelog

Notable changes to Tare, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Tare uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Notifications. Under More, then Notifications, a member turns each phone or
  computer on separately, sees the devices already on and removes any of them,
  and sends a test to check one. The switches say what would arrive: a morning
  check-in at an hour of their choosing with the day's budget, an evening
  check-in only when something is missing from the day, a weekly weigh-in
  nudge on a chosen weekday in place of that morning's check-in, and calendar
  changes and invitations. After a quiet week the check-ins pause and one note
  a week asks how it is going. An instance without keys says so on the screen;
  an administrator mints a pair with `manage.py vapid-keys`.

- Dashboard layout. Under More, then Display, a member drags or steps the
  five Dashboard cards into their own order and turns any of them off; the
  arrangement is kept on the account, so every device agrees. New accounts
  open on Today's numbers, then the calendar, then Food and Activity,
  Progress and Community. The tour skips a card that is hidden.

### Changed

- What a workout shares belongs to the workout. The three switches under
  More, then Sharing, are read once, when a session arrives, and stamped on
  it: they shape what syncs next rather than reaching back through sessions
  already in the feed, and the screen says so. Every session then carries the
  same three switches on its own page, so one morning is opened or closed
  without moving any other. Existing sessions keep exactly the visibility
  they had. What a session shares is also grouped the way it reads: the
  details switch covers the name of the activity and the numbers on the card,
  the climb among them, and the route switch covers the map, the
  minute-by-minute readings and the splits together.
- The community feed is one picture. A row that is not shared is in nobody's
  feed, its owner's included, so the small red lock and the "Only you can see
  this." sheet are gone; a member's own sessions, days and weigh-ins are all
  still theirs to read in Fitness, the Journal and Progress. A session that
  keeps its details back reads "synced a workout" rather than naming the
  activity, for everybody alike.
- A scanned food that came with no ingredients says so: the member's form
  reads "No ingredients came with the scan.", and the review queue tells the
  reviewer where to type them before approving.

### Fixed

- A barcode that Open Food Facts has never seen opens the empty form with
  the code filled in, and the form says nothing was on file for it. Before,
  the scan ended in "The barcode database did not answer." because the
  lookup's not-found answer was read as a failure. A product name or brand
  longer than the database allows is cut to fit instead of failing the scan.

## 0.6.0 - 2026-09-15

### Added

- A calendar. An appointment takes a time or a whole day, can run across
  several days, and can repeat by week, month or year; it is read as a month,
  as one day against the clock, or as today's hours at the top of the
  Dashboard. A calendar can be shared with a friend by invitation, any member
  can add another friend, rename it or recolor it, and leaving one takes your
  own appointments with you. A friend can be invited to a single appointment,
  and anything already in that hour is named before it is saved. Tare sends no
  reminders.
- Invitations waiting on an answer sit at the top of the Calendar, the Calendar
  row under More says how many there are, and the More badge counts them.
- On a wide window the right-hand column carries the month on the Dashboard
  instead of repeating the figures the cards beside it already show.

### Changed

- Tare's green is quieter. The ground, the text and the hairlines are warm
  neutrals in both themes, and the accent keeps its colour but stops doing
  every job: the footer links, the database mark, the plus icons, the selected
  chips and the names in the feed are neutral now, the waiting count is amber,
  and the raised plus casts a plain shadow.
- The desktop stops being a widened phone. More is grouped under Your account,
  Tracking, Community and Help, in two columns beside the rail; an empty meal,
  Activity or Biometrics slot in the Journal is one row until it has something
  in it; Targets and the calendar's day view take the full width of the page;
  and on the review screens the right column shows what is waiting and the
  last decisions instead of the feed.
- The workout map follows the new palette: its ground, roads, buildings and
  lettering are the same warm neutrals as the card around it, in both themes.
- The calendar reads better on a wide window: a month chip gives the
  appointment its name and adds the time only where there is room for both,
  the day against the clock keeps a column's width with the month beside it,
  and the right-hand column carries the day the month is asking about. The
  Today card says how many appointments are earlier than the hours it shows.
- The gold a shared calendar wears is a colour of its own in the light theme,
  so it is not read as the orange beside it.
- Every card says its own name in one style, the three rings sit above their
  macro bars rather than beside a second set of rings, journal entries carry
  the picture their food already has, a member's page shows what they have
  shared, and a wide window gives its cards two columns instead of leaving the
  room as gutter.
- Roster rows say which way a pending friend request went. An upload-only
  member is told where sync lives. A removal that fails puts the row back and
  says why. Sheets keep the keyboard inside them and hand focus back on close.
  A new version waits behind a Reload bar instead of being swapped in under an
  open page.
- Weight readings are read over the last four hundred days rather than the
  whole history, food lookups for a day's micronutrients and a recipe's weight
  are batched, and a composite index covers reading a day.
- The api image runs on Python 3.14; CI tests on the same version. Dependency
  refresh: nginx image digest, framer-motion, lucide-react, alembic, ruff.

### Fixed

- An appointment you accepted an invitation to says Accepted on its card, and
  its Decline asks first and tells the organizer you backed out instead of
  dropping you from their guest list.
- The review log opens again after an administrator has matched vitamins from
  USDA; the matched row says how many were filled and which record they came
  from.
- Withdrawing a submission handed the day's allowance back. The daily
  submission and photo caps now count marks that are only ever added.
- The Recently used header drew its plus twice.

### Security

- Friend requests are limited to thirty an hour.

## 0.5.0 - 2026-09-09

### Added

- A footer on every screen naming the version, the license and who wrote it.
- Weekly scheduled CI, so the dependency audits still run when nobody has
  pushed, and a job that parses the compose file and builds both images.
- Dependabot, monthly and grouped by ecosystem, with major versions left to be
  taken by hand.
- A CHANGELOG and a CONTRIBUTING file. SECURITY gained a scope, a supported
  versions line and what to expect for a response.
- README: screenshots, links to each document, the first-account and invite
  steps, and the badge and copyright line.

### Changed

- The development compose file is `docker-compose.dev.yml` and is opt-in rather
  than something compose reads on its own. A deployment runs plain
  `docker compose up` and never sees it.
- Health data sync names six metrics rather than five, Heart Rate included,
  which is what the hour bars are drawn from.
- Copy cleanup across the app: straight apostrophes, promises about future
  features removed, and several empty states now say what comes next.
- `.env.example` says what `TRUSTED_PROXY_HOPS` actually counts, and that Tare
  offers US time zones only.
- The deployment guide restores file ownership before the api is started again,
  and gained a backup section with a cron example and a retention note.

### Fixed

- The date of birth box on the Profile screen showed empty even when the
  account had one, because it was drawn before the profile had loaded.

### Security

- An instance with no SMTP settings no longer mints an email token or writes a
  live verification link into its log when an address is set from the account
  screen. The address is taken as typed, the way sign-up takes one there.
- Writing an address to an account is now also counted per account, not only
  per address, so a signed-in member cannot walk a list of addresses to find
  out who else is a member here.
- `object-src 'none'` added to the Content-Security-Policy the web container
  sends.

## 0.4.0 - 2026-09-08

- Workout details are private by default. The feed still carries the row saying
  somebody synced a workout, but the breakdown of the session opens only when
  its owner opens it, and route maps are a switch under that.
- Sharing, Workouts is three switches instead of five, and existing accounts
  start closed.

## 0.3.1 - 2026-09-08

- An email address is refused as a display name, at sign-up and on the profile
  screen: a phone autofilling one into the field had put it in front of
  everybody.
- Date of birth is typed rather than picked from a calendar.

## 0.3.0 - 2026-09-08

- Workout sharing split into stats, route maps, minute-by-minute and splits,
  each its own switch, with the master switch still holding all of them. Splits
  moved to the server so they can be shared without the minutes.
- Feed workout rows read as "synced", with the figures off the row, and a
  private row wears a lock rather than a chip.
- Both charts carry grid lines, the Exercise card and its screens are called
  Activity, and the Auto-log sheet takes several mealtimes at once.
- A link under an invite address previews as an invitation; every other address
  previews as the app.

## 0.2.0 - 2026-09-08

- The first deployment documentation: a guide to every setting, the proxy, the
  first account, invites, the vitamin match picker and the backfill.
- The health export format written down endpoint by endpoint, with the caps,
  the refusals and the rate limits.
- The targets specification brought in line with the five weight-change steps.
- A README Checks section that matches what CI runs, and a security file naming
  where to report a vulnerability privately.
