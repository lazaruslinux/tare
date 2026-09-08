// What Tare is, in one paragraph and one place. The About screen says it and
// so does the invite, and the two must never drift apart.
export const WHAT_TARE_IS =
  'Tare is a community-managed food & ingredient database, fitness journal, & nutrition ' +
  'tracker. Members contribute to Tare by scanning barcodes and uploading food items into ' +
  'the Tare database. Every submitted item is reviewed by a real human being and, if ' +
  'approved, added to Tare for others to use & track in their journals, or add to personal ' +
  'recipes. The more items that get scanned, Tare becomes more accurate, faster & easier to ' +
  'use. Tare can also identify foods that are high in added sugars, artificial ingredients ' +
  '& dyes, or other harmful additives, based on publicly available research.'

// What is inside, said the way somebody arriving on an invite would ask it.
export const WHAT_YOU_CAN_DO: { name: string; what: string }[] = [
  {
    name: 'Community Food Database',
    what: 'A growing index of food items submitted by you. Photos, Nutrition labels & ingredients.',
  },
  {
    name: 'Weight Loss Plan',
    what:
      'Pick a goal weight and a goal rate. Choose your daily activity level, and Tare will ' +
      'calculate your daily calorie budget, an estimated goal date, and macro targets ' +
      'specific to your needs.',
  },
  {
    name: 'Journal',
    what:
      'Quickly log your biometrics (weight, body fat %, other smart scale options), your ' +
      'breakfast, lunch, dinner, snacks, view your macro breakdowns & calorie deficit. ' +
      'Workouts are automatically added via Device Sync and your calories are adjusted.',
  },
  {
    name: 'Fitness + Device Sync',
    what:
      'Upload your Apple Health or Health Connect workouts & health metrics to receive full ' +
      'insights. Full instructions inside. (Requires use of a free & simple export app)',
  },
  {
    name: 'Community Feed',
    what:
      'Workouts, finished journal days & weigh-in wins, shared only with the friends you choose. Forums coming in the future.',
  },
]

// The address is the one the reader is on, never a hostname written into the repo.
export const platforms = (host: string): string =>
  'Tare is built as a web-app and is available on desktop browsers as well as a mobile ' +
  'in-browser app. It is not currently available on the App Store or Play Store. You can ' +
  `add a shortcut to ${host} on your phone's home screen to treat it as a full-screen ` +
  'phone app.'

export const DATA_PRIVACY =
  'This project is hosted on a private server. There are no trackers on this web-app and ' +
  'your data will never be sold or used for anything other than what you see in Tare.'
