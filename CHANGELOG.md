# Changelog

Notable changes to Tare, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Tare uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- The api image runs on Python 3.14; CI tests on the same version. Dependency
  refresh: nginx image digest, framer-motion, lucide-react, alembic, ruff.

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
