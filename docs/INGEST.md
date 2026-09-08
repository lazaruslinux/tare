# Syncing a phone

Tare can take what your phone already records: steps, the calories you burned
moving, exercise minutes, resting heart rate, your weight, your workouts, and
everything else your phone keeps. You set this up once and then forget it.

Nothing is sent from Tare to your phone. The phone posts to Tare, on a schedule
you pick, and Tare stores what arrives.

## What you need first

1. Open Tare, go to More, then Health data sync.
2. Under Automatic sync setup, tap Make my sync key.
3. Copy the two lines it shows you: the address to send to, and the
   authorization line. The key is shown once and never again. If you lose it,
   make a new one; the old one stops working the moment you do.

The address looks like `https://<your Tare address>/api/ingest/health` and the
authorization line looks like `Bearer <a long string of letters>`.

Three addresses do all of this, and there are no others:

| Address | What it takes |
|---|---|
| `POST /api/ingest/health` | An export posted by a phone, with the sync key on the Authorization header. |
| `POST /api/ingest/upload` | The same export handed over as a file by somebody signed in. |
| `DELETE /api/ingest/uploads` | Nothing. It takes back every number that arrived in a file. |

## iPhone

The app is Health Auto Export. It reads Apple Health and posts it on a
schedule. You set up two automations: one for workouts, one for everything else.

1. Install Health Auto Export from the App Store and open it.
2. Allow it to read Health when it asks. If you say no, it has nothing to send.
3. Go to Automations and add a new one. Fill it in like this:

| Field | What to put |
|---|---|
| Name | Anything you like, "Tare workouts" is fine |
| Enabled | On |
| Automation Type | REST API |
| URL | The address you copied |
| Timeout Interval | 60 |
| Header Key | Authorization |
| Header Value | The authorization line you copied |
| Data Type | Workouts |
| Include Route Data | On |
| Include Workout Metrics | On |
| Time Grouping | Minutes |
| Export Format | JSON |
| Export Version | v2 |
| Date Range | Default, and see The first run below |
| Batch Requests | Off |
| Sync Cadence | Every 5 minutes |

4. Add a second automation for the readings that are not workouts:

| Field | What to put |
|---|---|
| Name | "Tare health" |
| Enabled | On |
| Automation Type | REST API |
| URL | The same address |
| Timeout Interval | 60 |
| Header Key | Authorization |
| Header Value | The same authorization line |
| Data Type | Health Metrics |
| Select Health Metrics | Step Count, Active Energy, Walking + Running Distance, Apple Exercise Time and Resting Heart Rate, which is the list the Health data sync screen names. Heart Rate as well, which is what the heart rate hour bars are drawn from. Turn on anything else you want kept: sleep, heart rate variability, oxygen, weight, body fat. Tare stores all of it and draws none of it yet |
| Summarize Data | On |
| Time Grouping | Day, or Hour if you want the hour by hour bars |
| Export Format | JSON |
| Export Version | v2 |
| Date Range | Previous 7 Days, and see The first run below |
| Batch Requests | Off |
| Sync Cadence | Every 5 minutes |

5. Run each automation once by hand. Open Tare, go to Fitness, and the strip at
   the top should say Connected with the time it last heard from your phone.

Include Route Data is what draws the line on a workout. Tare throws away every
point within about 200 metres of where the workout started and where it ended
before it stores anything, so the line it keeps never starts at your door.

### The first run

A new automation sends what its date range covers, which is a day or two rather
than a history. To bring the last month in, set Date Range to Previous 30 Days
on each automation, run it once by hand, then set it back to what the table
above says. Nothing is sent twice: days that are already stored are recognised
and left alone.

## Android

The Android path is in development. The sync key and both addresses work, and
the upload portal takes a file the same way it does for an iPhone, but the
webhook route has not been fully tested and the numbers it produces may be
wrong. What follows is how it is meant to be set up.

Health Connect is where a Pixel watch, a Fitbit or Samsung Health leaves its
readings. A bridge app reads Health Connect and posts it to a webhook.

1. Install HC Webhook and open it.
2. Give it permission to read Health Connect when it asks.
3. Fill in its settings:

| Field | What to put |
|---|---|
| Webhook URL | The address you copied |
| Custom header, name | Authorization |
| Custom header, value | The authorization line you copied |
| Data types | Exercise Sessions, Heart Rate, Resting Heart Rate, Active Calories, Steps, Distance, Weight, Body Fat |
| Sync mode | Interval |
| Sync interval | 15 minutes, which is its shortest |

4. Run it once by hand and check the Fitness screen the same way.

Two things Health Connect does not send, so Tare cannot show them. There are no
routes, so an Android workout has no line. There is usually no calorie figure
for a session, so an Android workout's calories can be blank. Its exercise
minutes come from how long each session lasted.

## Either phone

- Sending the same days again is safe. Tare writes one figure per reading per
  day, and a workout that is already stored is recognised and left alone.
- The first sync can be large. Tare accepts a body up to 15 MB and reaches back
  one year before the day your account was made.
- Weigh-ins stay yours to enter. A weight or body fat your phone sends is kept
  with the rest of your health data and never writes a weigh-in for you.
- A workout that arrived from your phone cannot be deleted in Tare. Delete it
  on your phone and it stops being sent.
- A reading that looks impossible is stored anyway and marked. More than
  100,000 steps in a day, a resting heart rate outside 25 to 150, a run faster
  than 4 minutes a mile, a ride over 40 miles an hour: all kept, all flagged,
  and the flag is what says it looked odd.
- A workout whose figures cannot be describing a workout is the exception, and
  is skipped rather than stored: longer than 24 hours, further than 1,000
  kilometres, or over 50,000 calories. So is one with no name, no readable
  start time, or a start older than the account reaches back. That sync's
  record says how many were skipped and names the first of them.
- If your phone is set to kilojoules or kilometres, Tare converts on the way in
  and shows you your own units.

## What a workout brings

Out of a workout entry Tare reads its name, when it started and ended, how long
it lasted, the active energy it burned, the distance, whether it was indoor,
and the id the exporter gave it. `duration` is preferred over the two times and
the times are used when there is none. `heartRate` is read as the summary of
the whole session, its average and its maximum. `route` is the line, trimmed as
above. The per-minute arrays a session carries, distance, steps, heart rate and
active energy, are folded into one row a minute, up to a day of them.

A health metric is read differently. A reading with more than one figure, a
night's sleep in its stages or a blood pressure, keeps every field it arrived
with, and is given one headline number where one of those fields is an obvious
headline.

## What Tare refuses

None of this is about a number looking wrong. It is about an export that is too
big to read or is not an export at all, and every one of these answers before
the body is read properly.

- A body over 15 MB, refused without being read at all: 413, "Request body is
  too large."
- A body that is not JSON: 400, "Body must be JSON."
- A body that is not shaped like a health export: 400, "This file is not a
  health export." That is also the answer for one nested more than 12 levels
  deep or carrying more than 200,000 keys, because the walk that counts them
  stops at the ceiling rather than finishing the count.
- More than 200 kinds of reading in one export: 400, "That export carries too
  many kinds of reading for one sync."
- More than 2,000 workouts: 400, "That export carries too many workouts for one
  sync."
- More than 100,000 readings of one kind: 400, "That export carries too many
  readings of one kind for one sync."

Then the limiters, which count rather than read:

- Sixty posts a minute from one address, counted before the key is looked at,
  so guessing keys spends the same allowance as anything else.
- Sixty posts a minute for one account on top of that, because a phone moving
  between networks arrives from a new address each time.
- Five uploads an hour for one account.
- Five new sync keys a minute for one account.

A limiter that has had enough answers 429 with "Too many attempts just now.
Wait a few minutes and try again.", except an upload, which says "Too many
uploads. Try again in an hour."

One import is processed at a time across the whole server. A second waits its
turn; it is never refused for it.

## Import health data

Health data sync takes a file as well, which is the other way to bring a month of
history in. In Health Auto Export, export the range you want as JSON and save
the file to your phone. Then open Tare, go to More, then Health data sync, and
choose the file under Import health data.

It takes one JSON file, up to 15 MB. Upload your Workouts file and your Health
Metrics file separately. The metrics Tare draws are Step Count, Active Energy,
Walking + Running Distance, Apple Exercise Time and Resting Heart Rate, plus
Heart Rate for the hour bars, which is the same list as above; everything else
can stay unselected when creating the export, though anything extra that
arrives is kept. Anything already stored is skipped. Weigh-ins are never
written from a file.

The smallest file it reads whole looks like this, and the screen shows the same
example under Show the file layout:

```json
{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [
          { "date": "2026-09-07 08:00:00 -0700", "qty": 4000 },
          { "date": "2026-09-07 18:00:00 -0700", "qty": 4500 }
        ]
      }
    ],
    "workouts": [
      {
        "name": "Outdoor Run",
        "start": "2026-09-07 17:12:00 -0700",
        "end": "2026-09-07 17:54:00 -0700",
        "activeEnergyBurned": { "qty": 431, "units": "kcal" },
        "distance": { "qty": 4.02, "units": "mi" }
      }
    ]
  }
}
```

A Health Connect bridge export is read too, so anything that can write either
layout can be used; it does not have to be Health Auto Export.

Everything that arrives from a file is marked as such. Workouts from a file stay
out of the community feed unless you choose to share them, and the Remove
everything I uploaded row on the Health data sync screen deletes every number
that came from a file while leaving synced and typed-in data alone. Uploads are
limited to five an hour per account, a file that is not shaped like a health
export is refused before it is read in full, and an administrator can turn
uploads off for the whole instance with TARE_UPLOADS=false.

HC Webhook has no export to a file of its own, so on Android the file route
needs something else that can write either layout.

## Your imports

The bottom of Health data sync says what has arrived: how many days have data,
how many workouts came from a phone or a file, the first and last day covered,
and when something last arrived. Under that is the recent list, newest first, five at a
time with a Show more button, each row saying when it came, whether it was From sync, From upload or Removed
uploads, and what it brought. The list is kept for 90 days; the numbers above it
are read off your data and go back as far as it does.

## If it is not arriving

- Check the authorization line. It has to be the whole line, the word Bearer
  included.
- Check the address. It ends in `/api/ingest/health`.
- Make a new key from Health data sync and paste it into the automation again.
  Anything that already arrived stays where it is.
