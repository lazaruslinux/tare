// The three macros as the Dashboard and the Journal both read them: the same
// order, the same words, the same colours. One list, so the two screens cannot
// drift apart on what a day's protein looks like.

import { HEADLINE } from '../components/NutritionLabel'

// The Dashboard rings' colours, so a macro looks the same on both screens.
export const MACRO_COLOR: Record<string, string> = {
  protein_g: 'var(--violet)',
  carbs_g: 'var(--gold)',
  fat_g: 'var(--coral)',
}

// The headline four without the calories, which are said on their own above
// the bars rather than as one of them.
export const MACRO_BARS = HEADLINE.slice(1)
