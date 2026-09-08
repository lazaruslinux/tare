import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, Compass } from 'lucide-react'
import { useState } from 'react'

// The questions somebody actually asks, answered in the words the app uses.
// One fold each, one open at a time: this is read looking for one answer, not
// front to back.
const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Why can't I search for a food online?",
    a: "Search covers the Tare database and your own foods. Members build the database, and a person checks every food in it. A barcode scan is the only online lookup.",
  },
  {
    q: "What happens when I scan a barcode?",
    a: "A food already in Tare opens ready to log. A new one is filled in from the barcode for you to check, then keep private or submit.",
  },
  {
    q: "What happens when I submit a food?",
    a: "A reviewer checks it against the label. Log it right away while it waits. Approved foods get the green check. A turned-down food comes back with a note so you can fix it and send it again.",
  },
  {
    q: "Who are the reviewers?",
    a: "Members who check submissions against labels. They wear a shield by their name and never review their own. Apply under More once 100 of your foods are approved.",
  },
  {
    q: "Weigh it or a serving?",
    a: "Log sheets open on Weigh it, in grams, ounces or pounds. Tap 1 serving when you are not weighing. Tare remembers your choice for each food.",
  },
  {
    q: "What is Recently used?",
    a: "Your last ten logged foods. Favorites sits under it: tap Favorite on any food to keep it there.",
  },
  {
    q: "What is the difference between a recipe and a meal?",
    a: "A recipe is made in servings, like a pot of soup. A meal is one plate logged as one line, like your usual breakfast. Both can take a final weight in grams.",
  },
  {
    q: "How does Tare work out my calorie budget?",
    a: "From your age, gender, height, weight, activity and weight goal. Without a profile it uses 2,000 calories. Change any number under Targets. Tare estimates; it is not medical advice.",
  },
  {
    q: "What is BMR?",
    a: "Your BMR or Basal Metabolic Rate is the estimated amount of calories your body burns daily, based on age, gender, height, weight, and body fat percentage.",
  },
  {
    q: "What does Complete do in the Journal?",
    a: "Tap Complete at the top of a day to lock it and count it on the Dashboard. Tap Completed to unlock it.",
  },
  {
    q: "What is Auto-log?",
    a: "A food logged for you every day. Set it once from the food's page. Deleting it on one day changes only that day.",
  },
  {
    q: "How do I sync my phone?",
    a: "More, then Health data sync. iPhone uses the Health Auto Export app; Android uses Health Connect. Steps, workouts and weigh-ins then arrive on their own.",
  },
  {
    q: "What does Fitness show?",
    a: "Steps, distance, sessions and active calories by the hour, with trends. Open a workout for splits, heart rate, pace and the route map. The first and last 200 meters of a route are hidden.",
  },
  {
    q: "How do I read the Dashboard?",
    a: "The rings are today. Week to 6 months changes what the cards show. Tap or drag the bars for one day's numbers. Progress holds your weight line and goal.",
  },
  {
    q: "Who can see what?",
    a: "Only the friends you add under Members, and only what you switch on under Sharing. Workouts are shared with friends unless you turn them off, along with heart rate, calories and route maps. Age, gender and location show only if you switch them on. Your journal, weight, measurements and targets are always private, even from administrators.",
  },
  {
    q: "Where does feedback go?",
    a: "More, then Send feedback. Administrators read every one.",
  },
  {
    q: "Can I use pounds and ounces?",
    a: "Yes. More, then Display: units, clock and time zone.",
  },
]

export function Guide({ onTour }: { onTour: () => void }) {
  // Which question is open, by its place in the list. One at a time, so the
  // list stays a list.
  const [open, setOpen] = useState<number | null>(null)
  const reduced = useReducedMotion()

  return (
    <div className="t-card mb-3">
      <button type="button" className="t-row w-full text-left" onClick={onTour}>
        <Compass className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        <span className="min-w-0 flex-1 text-sm">Take the tour</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
      </button>
      {QUESTIONS.map((row, index) => {
        const showing = open === index
        return (
          <div key={row.q} className="t-row flex-col items-stretch">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={showing}
              onClick={() => setOpen(showing ? null : index)}
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
                  <p className="t-note mt-2">{row.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
