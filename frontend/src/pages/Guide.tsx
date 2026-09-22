import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, Compass } from 'lucide-react'
import { useState } from 'react'

// The questions somebody actually asks, answered in the words the app uses.
// One fold each, one open at a time: this is read looking for one answer, not
// front to back. Grouped under headings the way More groups its rows.
const GROUPS: { title: string; rows: { q: string; a: string }[] }[] = [
  {
    title: 'Logging a day',
    rows: [
      {
        q: 'How do I log a meal?',
        a: 'Open the Journal and tap Add on the meal. Search the Tare database and your own foods, or scan the barcode. Pick the label serving or tap Weigh it and type the grams.',
      },
      {
        q: 'What happens when I scan a barcode?',
        a: 'A food already in Tare opens ready to log. A new one is filled in from the barcode for you to check, then keep private or submit.',
      },
      {
        q: 'Weigh it or a serving?',
        a: 'Log sheets open on Weigh it, in grams, ounces or pounds. Tap 1 serving when you are not weighing. Tare remembers your choice for each food.',
      },
      {
        q: 'What is Recently used?',
        a: 'Your last ten logged foods. Favorites sits under it: tap Favorite on any food to keep it there.',
      },
      {
        q: 'What is Auto-log?',
        a: "A food logged for you every day. Set it once from the food's page. Deleting it on one day changes only that day.",
      },
      {
        q: 'What does Complete do in the Journal?',
        a: 'Tap Complete at the top of a day to lock it and count it on the Dashboard. Tap Completed to unlock it.',
      },
      {
        q: 'What is the difference between a recipe and a meal?',
        a: 'A recipe is made in servings, like a pot of soup. A meal is one plate logged as one line, like your usual breakfast. Both can take a final weight in grams.',
      },
    ],
  },
  {
    title: 'The database',
    rows: [
      {
        q: "Why can't I search for a food online?",
        a: 'Search covers the Tare database and your own foods. Members build the database, and a person checks every food in it. A barcode scan is the only online lookup.',
      },
      {
        q: 'What happens when I submit a food?',
        a: 'A reviewer checks it against the label. Log it right away while it waits. Approved foods get the green check. A turned-down food comes back with a note so you can fix it and send it again.',
      },
      {
        q: 'Who are the reviewers?',
        a: 'Members who check submissions against labels. They wear a shield by their name and never review their own. Apply under More once 100 of your foods are approved.',
      },
    ],
  },
  {
    title: 'Your numbers',
    rows: [
      {
        q: 'How does Tare work out my calorie budget?',
        a: 'From your age, gender, height, weight, activity and weight goal. Without a profile it uses 2,000 calories. Change any number under Targets. Tare estimates; it is not medical advice.',
      },
      {
        q: 'What does At rest mean?',
        a: 'The calories your body uses in a day before any activity, estimated from your age, gender, height, weight and body fat. Your budget starts there.',
      },
      {
        q: 'How do I read the Dashboard?',
        a: "The rings are today. Week to 6 months changes what the cards show. Tap or drag the bars for one day's numbers. Progress holds your weight line and goal. Arrange or hide the cards under More, then Display.",
      },
      {
        q: 'Can I change what the Dashboard shows?',
        a: 'Yes. More, then Display: drag a card by its grip, or use Move up and Move down, to set the order. Switch Show off to hide a card. Use the default order puts them back.',
      },
    ],
  },
  {
    title: 'Your phone',
    rows: [
      {
        q: 'How do I sync my phone?',
        a: 'More, then Health data sync. iPhone uses the Health Auto Export app; Android uses Health Connect. Steps and workouts then arrive on their own; weigh-ins you enter yourself.',
      },
      {
        q: 'Do I have to sync my phone?',
        a: 'No. Food, weight and targets work on their own. Sync your phone and Tare also reads your workouts in full: routes, splits, heart rate and how they trend, and your steps count toward your budget.',
      },
      {
        q: 'What does Fitness show?',
        a: 'Steps, distance, sessions and active calories by the hour, with trends. Open a workout for splits, heart rate, pace and the route map. The first and last 200 meters of a route are hidden.',
      },
    ],
  },
  {
    title: 'Everything else',
    rows: [
      {
        q: 'What is the calendar for?',
        a: 'Appointments, timed or all day, that show on your Dashboard and under Calendar. Open a day to read it against the clock. You can share a whole calendar with a friend, or invite them to one appointment.',
      },
      {
        q: 'Can Tare remind me to log?',
        a: 'Yes, where your administrator has set it up. More, then Notifications: turn on the device you are holding, then pick a morning check-in, an evening one, a weekly weigh-in, or calendar changes. Every phone and computer is turned on separately. On an iPhone, add Tare to the Home Screen first.',
      },
      {
        q: 'Who can see what?',
        a: 'Only the friends you add under Members, and only what you switch on under Sharing. Friends see that you synced a workout unless you turn that off; its details, route maps and splits show only if you switch them on. What you switch under Sharing applies to the workouts you sync from then on, and every workout carries the same switches on its own page. Age, gender and location show only if you switch them on. Your journal, weight, measurements and targets are always private, even from administrators.',
      },
      {
        q: 'Can I use pounds and ounces?',
        a: 'Yes. More, then Display: units, clock and time zone.',
      },
      {
        q: 'Where does feedback go?',
        a: 'More, then Send feedback. Administrators read every one.',
      },
    ],
  },
]

export function Guide({ onTour }: { onTour: () => void }) {
  // Which question is open, by its own words. One at a time, across every
  // group, so the list stays a list.
  const [open, setOpen] = useState<string | null>(null)
  const reduced = useReducedMotion()

  return (
    <>
      {/* The tour is a way in, not question zero, so it keeps its own card. */}
      <div className="t-card mb-3">
        <button type="button" className="t-row w-full text-left" onClick={onTour}>
          <Compass className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-sm">Take the tour</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </button>
      </div>
      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="t-micro mb-1">{group.title}</p>
          <div className="t-card mb-3">
            {group.rows.map((row) => {
              const showing = open === row.q
              return (
                <div key={row.q} className="t-row flex-col items-stretch">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 text-left"
                    aria-expanded={showing}
                    onClick={() => setOpen(showing ? null : row.q)}
                  >
                    <span className="min-w-0 flex-1 text-sm">{row.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted ${showing ? 'rotate-180' : ''}`}
                      strokeWidth={2}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {showing && (
                      <motion.div
                        className="overflow-hidden"
                        initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                        exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <p className="t-note mt-2 max-w-[60ch]">{row.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
