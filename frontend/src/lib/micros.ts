// The mirror of the backend's app/micros.py, and it has to stay one. A test
// there reads this file and refuses a list that has drifted.
//
// The FDA's twenty-seven: every vitamin and mineral with a Daily Value for
// adults and children four and older, in the order a label prints them. A food
// stores them per 100 of its base unit, and a screen never shows that figure:
// it scales it to the portion it is already showing.

export type Micro = {
  key: string
  label: string
  unit: string
  dv: number
}

export const MICROS: Micro[] = [
  { key: 'vitamin_a', label: 'Vitamin A', unit: 'mcg', dv: 900 },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', dv: 90 },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg', dv: 20 },
  { key: 'vitamin_e', label: 'Vitamin E', unit: 'mg', dv: 15 },
  { key: 'vitamin_k', label: 'Vitamin K', unit: 'mcg', dv: 120 },
  { key: 'thiamin', label: 'Thiamin', unit: 'mg', dv: 1.2 },
  { key: 'riboflavin', label: 'Riboflavin', unit: 'mg', dv: 1.3 },
  { key: 'niacin', label: 'Niacin', unit: 'mg', dv: 16 },
  { key: 'vitamin_b6', label: 'Vitamin B6', unit: 'mg', dv: 1.7 },
  { key: 'folate', label: 'Folate', unit: 'mcg', dv: 400 },
  { key: 'vitamin_b12', label: 'Vitamin B12', unit: 'mcg', dv: 2.4 },
  { key: 'biotin', label: 'Biotin', unit: 'mcg', dv: 30 },
  { key: 'pantothenic_acid', label: 'Pantothenic acid', unit: 'mg', dv: 5 },
  { key: 'choline', label: 'Choline', unit: 'mg', dv: 550 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dv: 1300 },
  { key: 'iron', label: 'Iron', unit: 'mg', dv: 18 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dv: 4700 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', dv: 420 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', dv: 11 },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg', dv: 1250 },
  { key: 'iodine', label: 'Iodine', unit: 'mcg', dv: 150 },
  { key: 'selenium', label: 'Selenium', unit: 'mcg', dv: 55 },
  { key: 'copper', label: 'Copper', unit: 'mg', dv: 0.9 },
  { key: 'manganese', label: 'Manganese', unit: 'mg', dv: 2.3 },
  { key: 'chromium', label: 'Chromium', unit: 'mcg', dv: 35 },
  { key: 'molybdenum', label: 'Molybdenum', unit: 'mcg', dv: 45 },
  { key: 'chloride', label: 'Chloride', unit: 'mg', dv: 2300 },
]

// What a food carries: only the keys something actually stated.
export type Micros = Record<string, number>

// An amount said the way a label says it. Micrograms and small milligram
// figures need a decimal to mean anything, so the rule is significance rather
// than a fixed place: nothing here is ever more than three digits long.
export function microText(amount: number): string {
  if (amount >= 100) return String(Math.round(amount))
  if (amount >= 10) return String(Math.round(amount * 10) / 10)
  return String(Math.round(amount * 100) / 100)
}

// How much of a day that much of a nutrient is, as a whole number.
export const percentDv = (micro: Micro, amount: number): number =>
  Math.round((amount / micro.dv) * 100)
