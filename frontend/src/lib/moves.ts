// The Stretches and moves library, copied word for word from docs/STRETCHES.md.
// Nothing here is computed and nothing is fetched: the list is the same for
// everybody, so it ships with the app.
//
// The wording is the contract. Anything that reads oddly is fixed in the doc
// first and copied back here.

// Where on the body an item works. Balance has no chip of its own (decision 1);
// its items sit under All and under Legs.
export type Place = 'back' | 'neck' | 'shoulders' | 'hips' | 'legs' | 'feet' | 'hands' | 'balance'

export type MoveItem = {
  // The doc's own numbering, 1 to 49, so an item keeps its name across edits.
  id: number
  name: string
  group: 'stretch' | 'move'
  place: Place
  // The how-to, one plain sentence each, drawn as a numbered list.
  steps: string[]
  // Hold or count, and how many times.
  howMuch: string
  // What it is for, with the medical term in parentheses where the doc has one.
  forLine: string
  // Only where a source gives a specific caution.
  skipIf?: string
}

// What a place is called on screen.
export const PLACE_LABEL: Record<Place, string> = {
  back: 'Back',
  neck: 'Neck',
  shoulders: 'Shoulders',
  hips: 'Hips',
  legs: 'Legs',
  feet: 'Feet',
  hands: 'Hands',
  balance: 'Balance',
}

// The filter row, in the doc's order. 'all' is the chip, not a place.
export const PLACE_CHIPS: { key: Place | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'back', label: 'Back' },
  { key: 'neck', label: 'Neck' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'hips', label: 'Hips' },
  { key: 'legs', label: 'Legs' },
  { key: 'feet', label: 'Feet' },
  { key: 'hands', label: 'Hands' },
]

// The whole of the safety copy, and it appears nowhere else.
export const MOVES_NOTE =
  'Go gently. Stop if anything hurts, and a sharp or sudden pain, or one after a fall, is for a clinician, not a stretch.'

export const MOVES: MoveItem[] = [
  {
    id: 1,
    name: 'Knee rolls',
    group: 'stretch',
    place: 'back',
    steps: [
      'Lie on your back, knees bent and pointing at the ceiling, feet flat.',
      'Slowly roll both knees to one side, hold a few seconds, bring them back up, then the other side.',
    ],
    howMuch: 'Five to ten.',
    forLine: 'loosening the lower back from side to side.',
  },
  {
    id: 2,
    name: 'Pelvic tilts',
    group: 'stretch',
    place: 'back',
    steps: [
      'Lie on your back, hands on your hips.',
      'Slowly tilt your hips so your lower back flattens into the bed, hold two seconds, then tilt the other way so a small gap opens under your lower back.',
    ],
    howMuch: 'Five to ten.',
    forLine: 'getting the lower back moving gently.',
  },
  {
    id: 3,
    name: 'Knee hug',
    group: 'stretch',
    place: 'back',
    steps: [
      'Lie on your back.',
      'Bring one knee up towards your chest, the other knee still pointing at the ceiling.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Two to three times each side.',
    forLine: 'the lower back and the front of the hip.',
  },
  {
    id: 4,
    name: 'Both knees hug',
    group: 'stretch',
    place: 'back',
    steps: [
      'Lie on your back and slowly bring both knees towards your chest; your hands can rest over the knees.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Two to three times.',
    forLine: 'the lower back.',
  },
  {
    id: 5,
    name: 'Cat and camel',
    group: 'stretch',
    place: 'back',
    steps: [
      'On hands and knees, hands under your shoulders.',
      'Gently arch your back up towards the ceiling and tuck your chin, then slowly let your back sink, push your chest towards the floor and look gently up.',
    ],
    howMuch: 'Hold each end a few seconds. Five to ten.',
    forLine: 'the whole spine, both ways.',
  },
  {
    id: 6,
    name: 'Sideways bend',
    group: 'stretch',
    place: 'back',
    steps: [
      'Stand with feet hip-width apart, arms at your sides.',
      'Slide one hand down your side as far as is comfortable, hold two seconds, come up, then the other side.',
    ],
    howMuch: 'Three each side.',
    forLine: 'the sides of the lower back.',
  },
  {
    id: 7,
    name: 'Head turn',
    group: 'stretch',
    place: 'neck',
    steps: [
      'Sit tall, shoulders down.',
      'Slowly turn your head towards one shoulder as far as is comfortable, hold five seconds, return, then the other side.',
    ],
    howMuch: 'Three each side.',
    forLine: 'turning further, more easily.',
  },
  {
    id: 8,
    name: 'Head tilt',
    group: 'stretch',
    place: 'neck',
    steps: [
      'Sit tall.',
      'Hold one shoulder down with the opposite hand and slowly tilt your head away from it.',
    ],
    howMuch: 'Hold five seconds. Three each side.',
    forLine: 'the sides of the neck.',
  },
  {
    id: 9,
    name: 'Chin nod',
    group: 'stretch',
    place: 'neck',
    steps: [
      'Sit tall, breastbone lifted a little, shoulder blades drawn gently back.',
      'Nod your chin down as far as you can without bending the neck; only the head moves.',
    ],
    howMuch: 'Hold five seconds. Five to ten.',
    forLine: 'the small muscles at the top of the neck (deep neck flexors) that hold your head up.',
  },
  {
    id: 10,
    name: 'Chin to chest',
    group: 'stretch',
    place: 'neck',
    steps: [
      'Slowly tilt your head down to rest your chin on your chest, gently tense, hold five seconds.',
    ],
    howMuch: 'Five times.',
    forLine: 'the back of the neck.',
  },
  {
    id: 11,
    name: 'Shoulder circle',
    group: 'stretch',
    place: 'shoulders',
    steps: [
      'Rest one hand on a chair and let the other arm hang.',
      'Swing it gently forwards and back, then in a small circle.',
    ],
    howMuch: 'About five each way.',
    forLine: 'a warm-up that loosens a stiff shoulder without loading it.',
  },
  {
    id: 12,
    name: 'Shoulder blade squeeze',
    group: 'stretch',
    place: 'shoulders',
    steps: [
      'Squeeze your shoulder blades back and together, hold five seconds; let them drop down, hold five seconds.',
    ],
    howMuch: 'Ten times.',
    forLine: 'the upper back that carries the neck and shoulders.',
  },
  {
    id: 13,
    name: 'Wall climb',
    group: 'stretch',
    place: 'shoulders',
    steps: [
      'Face a wall with one hand on it.',
      'Walk your fingers up the wall as high as is comfortable, then walk them back down.',
    ],
    howMuch: 'Five to ten.',
    forLine: 'reaching up, with the wall taking the weight.',
  },
  {
    id: 14,
    name: 'Hands-clasped lift',
    group: 'stretch',
    place: 'shoulders',
    steps: [
      'Clasp your hands in front of you and raise them over your head, letting the stronger side help.',
    ],
    howMuch: 'Hold five to ten seconds at the top. Five times.',
    forLine: 'reaching overhead.',
  },
  {
    id: 15,
    name: 'Table slide',
    group: 'stretch',
    place: 'shoulders',
    steps: [
      'Sit at a table with your palms on a cloth.',
      'Slide the cloth forwards, tilting from the waist with a straight back, until your arms are as straight as is comfortable.',
      'Let your head drop gently, hold five seconds, slide back.',
    ],
    howMuch: 'Five times.',
    forLine: 'reaching forward without strain.',
  },
  {
    id: 16,
    name: 'Knee to chest',
    group: 'stretch',
    place: 'hips',
    steps: [
      'Lie on your back.',
      'Pull one knee towards your chest with the other leg straight, to the point you feel a pull.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Two to three times each side.',
    forLine: 'the front of the hip and the lower back.',
  },
  {
    id: 17,
    name: 'Knee drop-outs',
    group: 'stretch',
    place: 'hips',
    steps: [
      'Lie on your back, knees bent, feet flat and hip-width apart.',
      'Let one knee drop out to the side as far as is comfortable, keeping your back flat, then bring it back.',
    ],
    howMuch: 'Five to ten each side.',
    forLine: 'turning the hip outward.',
  },
  {
    id: 18,
    name: 'Half-kneeling lunge',
    group: 'stretch',
    place: 'hips',
    steps: [
      'Kneel on one knee with the other foot in front.',
      'Lift the back knee slightly, look forward, and push your hips forward with your upper body upright.',
    ],
    howMuch: 'Hold five seconds. Three each side.',
    forLine: 'the front of the hip (hip flexors) that shortens from sitting.',
  },
  {
    id: 19,
    name: 'Heel slide',
    group: 'stretch',
    place: 'legs',
    steps: [
      'Lie with both legs straight.',
      'Slowly bend one knee by sliding the heel towards you as far as is comfortable, hold two seconds, slide back.',
    ],
    howMuch: 'Five to ten each side.',
    forLine: 'bending the knee further.',
  },
  {
    id: 20,
    name: 'Back-of-thigh stretch',
    group: 'stretch',
    place: 'legs',
    steps: [
      'Steady yourself and rest one heel on a low chair, leg straight.',
      'Bend the standing knee a little and lean forward from the hips until you feel a pull behind the raised thigh.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Two to three times each side.',
    forLine: 'the back of the thigh (hamstring).',
    skipIf: 'you have pain running down the leg; it can pull on the nerve.',
  },
  {
    id: 21,
    name: 'Front-of-thigh stretch',
    group: 'stretch',
    place: 'legs',
    steps: [
      'Stand holding a wall, bend one knee and hold the foot behind you, knees together, kneecap pointing at the floor.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Two to three times each side.',
    forLine: 'the front of the thigh (quadriceps).',
  },
  {
    id: 22,
    name: 'Calf stretch at the wall',
    group: 'stretch',
    place: 'feet',
    steps: [
      'Face a wall, hands on it.',
      'Put one foot behind the other, back leg straight and heel down, front knee bent, and lean in until you feel a pull in the back of the lower leg.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Three times each side.',
    forLine: 'the muscle at the back of the lower leg (calf) that pulls on the heel.',
  },
  {
    id: 23,
    name: 'Bent-knee calf stretch',
    group: 'stretch',
    place: 'feet',
    steps: ['The same, with the back knee slightly bent.'],
    howMuch: 'Hold 20 to 30 seconds. Three times each side.',
    forLine: 'the deeper part of the same muscle (soleus).',
  },
  {
    id: 24,
    name: 'Toe pull',
    group: 'stretch',
    place: 'feet',
    steps: [
      'Sit and cross one foot over the other knee.',
      'Hold your toes and gently pull them back towards the shin until you feel a pull in the arch.',
    ],
    howMuch: 'Hold 20 to 30 seconds. Three times.',
    forLine: 'the band under the foot (plantar fascia) that is tight in the morning.',
  },
  {
    id: 25,
    name: 'Towel stretch',
    group: 'stretch',
    place: 'feet',
    steps: [
      'Sit with the leg straight, a towel looped around the ball of the foot, knee straight, and pull the towel towards you.',
    ],
    howMuch: 'Hold 20 seconds. Three times. Best first thing in the morning.',
    forLine: "the same band, before the day's first steps.",
  },
  {
    id: 26,
    name: 'Rolling',
    group: 'stretch',
    place: 'feet',
    steps: ['Roll the underside of the foot over a tennis ball or a bottle for one to two minutes.'],
    howMuch: 'One to two minutes.',
    forLine: 'easing the sole.',
  },
  {
    id: 27,
    name: 'Tendon glides',
    group: 'stretch',
    place: 'hands',
    steps: [
      'Start with the fingers straight.',
      'Make a hook (bend the fingertips and middle joints, knuckles straight), open; make a full fist, open; make a flat fist (fingers bent at the knuckles, straight beyond), open.',
    ],
    howMuch: 'Five to ten rounds.',
    forLine: 'letting the finger cords (flexor tendons) slide freely.',
  },
  {
    id: 28,
    name: 'Thumb across',
    group: 'stretch',
    place: 'hands',
    steps: [
      'Hold your hand up as if saying stop.',
      'Move the thumb across the palm to the base of the little finger, then back.',
    ],
    howMuch: 'Five to ten.',
    forLine: "the thumb's reach.",
  },
  {
    id: 29,
    name: 'Hand lift',
    group: 'stretch',
    place: 'hands',
    steps: [
      'Rest the forearm on the table with the hand over the edge, palm down.',
      'Lift the hand up until you feel a gentle pull, hold 20 to 30 seconds, return.',
    ],
    howMuch: 'Two to three times.',
    forLine: 'the top of the forearm.',
  },
  {
    id: 30,
    name: 'Palm turn',
    group: 'stretch',
    place: 'hands',
    steps: ['Elbow bent to a right angle, turn the forearm so the palm faces up, then down.'],
    howMuch: 'Five to ten.',
    forLine: 'turning the wrist, like a key.',
  },
  {
    id: 31,
    name: 'Wave',
    group: 'stretch',
    place: 'hands',
    steps: [
      'Forearm on the table or knee with a towel under it, thumb up.',
      'Move the wrist up and down as if waving.',
    ],
    howMuch: 'Five to ten.',
    forLine: "the wrist's full range.",
  },
  {
    id: 32,
    name: 'Bird dog',
    group: 'move',
    place: 'back',
    steps: [
      'On hands and knees, back straight.',
      'Tighten your stomach and raise one arm straight forward, hold ten seconds, lower.',
    ],
    howMuch: 'Ten times each side. When that is easy, lift one leg straight behind you instead.',
    forLine: 'the muscles that hold the lower back steady (the core).',
  },
  {
    id: 33,
    name: 'Bridge',
    group: 'move',
    place: 'back',
    steps: [
      'Lie on your back, knees bent, feet flat.',
      'Lift your hips and lower back off the floor, hold five seconds, lower slowly.',
    ],
    howMuch: 'Five to ten.',
    forLine:
      'the muscles in your buttocks (glutes) and the back of your thighs (hamstrings) that carry the hip and back.',
  },
  {
    id: 34,
    name: 'Belly draw-in',
    group: 'move',
    place: 'back',
    steps: [
      'Lie on your front, arms at your sides.',
      'Pull your stomach in around your belly button and hold five seconds, breathing the whole time.',
    ],
    howMuch: 'Three times, building to ten seconds.',
    forLine: 'the deep stomach muscles (transverse abdominis) that support the back.',
  },
  {
    id: 35,
    name: 'Wall press-up',
    group: 'move',
    place: 'shoulders',
    steps: [
      "Stand an arm's length from a wall, hands flat on it at chest height, fingers pointing up.",
      'Back straight, slowly bend your arms with elbows by your sides until your face nears the wall, then push back.',
    ],
    howMuch: 'Five to ten. Rest a minute and go again, up to three sets.',
    forLine: 'the chest, shoulders and arms without the floor.',
  },
  {
    id: 36,
    name: 'Backwards table press',
    group: 'move',
    place: 'shoulders',
    steps: [
      'Stand with your back to a table, palms on its edge.',
      'Gently press your shoulder blades back and your hands into the table, hold five seconds.',
    ],
    howMuch: 'Five to ten.',
    forLine: 'the muscles around the shoulder.',
  },
  {
    id: 37,
    name: 'Bottle curls',
    group: 'move',
    place: 'shoulders',
    steps: [
      'Hold a water bottle in each hand, arms at your sides.',
      'Slowly bend the elbows until the bottles reach your shoulders, then lower.',
    ],
    howMuch: 'Five, up to three sets. Sitting is fine.',
    forLine: 'the front of the arms (biceps).',
  },
  {
    id: 38,
    name: 'Standing leg back',
    group: 'move',
    place: 'hips',
    steps: [
      'Hold a counter.',
      'Move one leg straight back, knee straight, clench the buttock; do not lean forward.',
    ],
    howMuch: 'Hold five seconds. Five each side.',
    forLine: 'the muscles behind the hip (glutes).',
  },
  {
    id: 39,
    name: 'Standing leg out',
    group: 'move',
    place: 'hips',
    steps: [
      'Hold a counter.',
      'Lift one leg straight out to the side, body upright, hold five seconds, lower slowly.',
    ],
    howMuch: 'Five each side.',
    forLine: 'the muscles on the outside of the hip (hip abductors) that steady you when you walk.',
  },
  {
    id: 40,
    name: 'March on the spot',
    group: 'move',
    place: 'hips',
    steps: ['Hold a counter and march, bringing the knees up in turn.'],
    howMuch: 'Twenty steps.',
    forLine: 'lifting the knee and warming up the hips.',
  },
  {
    id: 41,
    name: 'Sit to stand',
    group: 'move',
    place: 'legs',
    steps: [
      'Sit on the edge of a chair, feet hip-width apart, lean slightly forward.',
      'Stand up slowly using your legs, look forward, then sit back down slowly with as little help from your hands as you can.',
    ],
    howMuch: 'Five, slower is better. Start with a cushion on the seat if the chair is low.',
    forLine: 'getting out of chairs without pain.',
  },
  {
    id: 42,
    name: 'Mini squat',
    group: 'move',
    place: 'legs',
    steps: [
      'Hands on the back of a chair, feet hip-width apart.',
      'Slowly bend the knees as far as is comfortable, keeping them over your big toes and your back straight, then stand and squeeze your buttocks.',
    ],
    howMuch: 'Five to ten.',
    forLine: 'the thighs and buttocks.',
  },
  {
    id: 43,
    name: 'Thigh squeeze',
    group: 'move',
    place: 'legs',
    steps: [
      'Lie or sit with the leg straight.',
      'Tighten the muscle at the front of your thigh and gently push the back of the knee down.',
    ],
    howMuch: 'Hold ten seconds, relax. Five to ten each side.',
    forLine: 'the front-of-thigh muscle (quadriceps) that steadies the knee.',
  },
  {
    id: 44,
    name: 'Straight leg raise',
    group: 'move',
    place: 'legs',
    steps: [
      'Lie with one leg bent and the other straight.',
      'Lift the straight leg a few inches, hold five seconds, lower slowly.',
    ],
    howMuch: 'Five to ten each side.',
    forLine: 'strength without bending the knee.',
  },
  {
    id: 45,
    name: 'Step up',
    group: 'move',
    place: 'legs',
    steps: [
      'Stand at the bottom step, near a rail.',
      'Step up with one leg, bring the other up to join it, step down, slowly and in control.',
    ],
    howMuch: 'Up to five each leg.',
    forLine: 'stairs and balance.',
  },
  {
    id: 46,
    name: 'Heel raises',
    group: 'move',
    place: 'legs',
    steps: ['Hands on the back of a chair.', 'Slowly rise onto your toes, then lower.'],
    howMuch: 'Five to ten. Let go of the chair when it is easy.',
    forLine: 'the lower leg, which takes load off the heel.',
  },
  {
    id: 47,
    name: 'Single leg stand',
    group: 'move',
    place: 'balance',
    steps: [
      'Face a wall with your fingertips touching it.',
      'Lift one foot, hips level, a slight bend in the standing knee.',
    ],
    howMuch: 'Hold five to ten seconds, working up to 20. Three each side.',
    forLine: 'balance, which protects the knees and hips.',
  },
  {
    id: 48,
    name: 'Heel-to-toe walk',
    group: 'move',
    place: 'balance',
    steps: [
      "Place one heel directly in front of the other foot's toes, then the same with the other foot, looking forward.",
      'Fingers on a wall if you need it.',
    ],
    howMuch: 'At least five steps.',
    forLine: 'balance.',
  },
  {
    id: 49,
    name: 'Sideways walk',
    group: 'move',
    place: 'balance',
    steps: [
      'Feet together, knees slightly bent.',
      'Step sideways slowly and in control, one foot then the other, without letting your hips drop.',
    ],
    howMuch: 'Ten steps each way.',
    forLine: 'balance and the outside of the hips.',
  },
]

// A chip keeps its place, and Legs carries the balance items with it.
export function inPlace(item: MoveItem, chip: Place | 'all'): boolean {
  if (chip === 'all') return true
  if (chip === 'legs') return item.place === 'legs' || item.place === 'balance'
  return item.place === chip
}
