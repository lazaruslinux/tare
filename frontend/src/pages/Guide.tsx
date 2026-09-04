import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

// The questions somebody actually asks, answered in the words the app uses.
// One fold each, one open at a time: this is read looking for one answer, not
// front to back.
const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Why can't I search for a food online?",
    a:
      'Search looks in the Tare database and in your own foods, nothing else. The ' +
      'database starts empty and is built by the members, so every food in it has been ' +
      'checked by a person. Scanning a barcode is the one moment Tare asks an online ' +
      'source; after that the food is yours to correct and submit.',
  },
  {
    q: 'What happens when I submit a food?',
    a:
      'It waits for an administrator to check it against the label. You can log it ' +
      'straight away while it waits. Once approved it is in the Tare database for ' +
      'everyone and only an administrator can change it; if you spot a mistake, open the ' +
      'food and tap Report an issue. If it is not approved you get a note, and you can ' +
      'fix it and submit again.',
  },
  {
    q: 'What is My foods?',
    a:
      'The foods you made or scanned, plus any shared foods you added from the Tare ' +
      'database, newest first. Taking a food off the list only changes your list; the ' +
      'shared food stays in the database and you can add it back.',
  },
  {
    q: 'Label serving or weigh it?',
    a:
      'Every food opens on its label serving. Tap Weigh it to switch to grams or ounces, ' +
      'and Tare remembers that choice for that food from then on.',
  },
  {
    q: 'How does Tare work out my calorie budget?',
    a:
      'From your age, gender, height, weight and how active your days are, with your ' +
      'weight goal on top. Until your profile is filled in, Tare uses a general 2,000 ' +
      'calorie guideline. You can see and change every number under Targets. Tare ' +
      'estimates. It is not medical advice.',
  },
  {
    q: 'What does Mark day as complete do?',
    a:
      "It locks that day's journal so nothing changes by accident, and the Dashboard " +
      'counts it as a completed day. Tap the check again to unlock it.',
  },
  {
    q: 'What is Auto-log?',
    a:
      "A food you eat every day, logged for you. Set it once from the food's page with " +
      'an amount and a meal, and it lands in that meal each day with an Auto chip. ' +
      'Delete it on one day and only that day changes.',
  },
  {
    q: 'How do I sync my phone?',
    a:
      'Open More, then Health data sync, and follow the steps for your phone. An iPhone ' +
      'sends through the Health Auto Export app; an Android phone sends through Health ' +
      'Connect. Steps, workouts, exercise minutes and weigh-ins arrive on their own once ' +
      'it is set up.',
  },
  {
    q: 'Who can see what?',
    a:
      'Only invited members can sign in, and nothing on Tare is public. Your workouts ' +
      'are shared with other members unless you turn that off under Sharing, where you ' +
      'also choose whether heart rate, calories burned and the route line are shown. ' +
      'Your age, gender and location are hidden unless you switch them on. Your food ' +
      'journal, weight, measurements and targets are private: other members never see ' +
      'them, and neither does an administrator.',
  },
]

export function Guide() {
  // Which question is open, by its place in the list. One at a time, so the
  // list stays a list.
  const [open, setOpen] = useState<number | null>(null)
  const reduced = useReducedMotion()

  return (
    <div className="t-card mb-3">
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
