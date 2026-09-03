# Syncing a phone

Tare can take what your phone already records: steps, the calories you burned
moving, exercise minutes, resting heart rate, your weight, your workouts, and
everything else your phone keeps. You set this up once and then forget it.

Nothing is sent from Tare to your phone. The phone posts to Tare, on a schedule
you pick, and Tare stores what arrives.

## What you need first

1. Open Tare, go to More, then Sync a device.
2. Pick iPhone or Android.
3. Tap Make my sync key.
4. Copy the two lines it shows you: the address to send to, and the
   authorization line. The key is shown once and never again. If you lose it,
   make a new one; the old one stops working the moment you do.

The address looks like `https://<your Tare address>/api/ingest/health` and the
authorization line looks like `Bearer <a long string of letters>`.

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
| Date Range | Default |
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
| Select Health Metrics | Everything you want Tare to keep. Step Count, Active Energy, Apple Exercise Time and Resting Heart Rate are the four Tare draws today. Turn on anything else you want kept: sleep, heart rate variability, oxygen, weight, body fat. Tare stores all of it |
| Summarize Data | On |
| Time Grouping | Day, or Hour if you want the hour by hour bars |
| Export Format | JSON |
| Export Version | v2 |
| Date Range | Previous 7 Days |
| Batch Requests | Off |
| Sync Cadence | Every 5 minutes |

5. Run each automation once by hand. Open Tare, go to Fitness, and the strip at
   the top should say Connected with the time it last heard from your phone.

Include Route Data is what draws the line on a workout. Tare throws away every
point within about 200 metres of where the workout started and where it ended
before it stores anything, so the line it keeps never starts at your door.

## Android

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
- Weighing in yourself always wins. If you logged a weight in Tare for a day,
  a reading from your scale never replaces it. On a day with no weigh-in, the
  scale's reading is used. Body fat fills a blank and never overwrites a number
  you entered.
- A workout that arrived from your phone cannot be deleted in Tare. Delete it
  on your phone and it stops being sent.
- If a reading looks impossible, Tare stores it anyway and marks it. Nothing is
  thrown away for looking wrong.
- If your phone is set to kilojoules or kilometres, Tare converts on the way in
  and shows you your own units.

## If it is not arriving

- Check the authorization line. It has to be the whole line, the word Bearer
  included.
- Check the address. It ends in `/api/ingest/health`.
- Make a new key from Sync a device and paste it into the automation again.
  Anything that already arrived stays where it is.
