# Targets math

This document is the specification for every number Tare computes about a person: the daily calorie budget, the protein, carbohydrate and fat targets, the ceilings for saturated fat, added sugars and sodium, the credit for logged exercise, the limits on weight-change goals, the projected goal date, and the trend weight. The implementation follows the numbered decisions below and nothing else. Every number carries a bracketed source number that points to the Sources section.

Tare estimates. It does not diagnose, treat, or prescribe. The equations here are population averages that can miss any one person by several hundred calories a day. The app says so, in plain words, wherever a computed number appears for the first time.

Items marked UNVERIFIED were not confirmed against a primary source at the time of writing and must not be promoted to fact without a source.

## Decisions

### Energy

1. Resting energy is estimated with the Mifflin-St Jeor equation. Female: 10 x weight(kg) + 6.25 x height(cm) - 5 x age(years) - 161. Male: 10 x weight(kg) + 6.25 x height(cm) - 5 x age(years) + 5. [1]
   Why: the American Dietetic Association's systematic review found it the most reliable of the common equations, predicting measured resting rate within 10 percent in more non-obese and more obese adults than any other equation tested, Harris-Benedict included. [2] The often-quoted split (82 percent of non-obese, 70 percent of obese adults within 10 percent) sits in the full text, which was not reachable; it is UNVERIFIED here.

2. When the member has recorded a body-fat percentage, resting energy uses the Cunningham (Katch-McArdle) form instead: 370 + 21.6 x lean mass(kg), where lean mass = weight x (1 - body fat / 100). [3]
   Why: lean mass explains most of the variation in resting energy, so a lean-mass equation removes the sex and age terms that Mifflin-St Jeor uses as proxies. [3] The switch happens only when body fat was recorded from a scale or measurement within the last 90 days, because consumer bioimpedance scales carry errors of several percentage points and a stale reading is worse than a weight-based estimate. The measurement-quality claim is UNVERIFIED pending a primary source on consumer scale error.

3. Harris-Benedict (original 1918 and revised 1984) is not used. [4][5]
   Why: it overestimates resting energy in modern populations and was less accurate than Mifflin-St Jeor in the same review. [2]

4. Mifflin-St Jeor was derived from adults aged 19 to 78. [1] Tare accepts members 18 and over. Members over 78 get the same estimate with the standard disclaimer; no separate equation is used. Accuracy above 80 is UNVERIFIED.

5. Activity level multiplies resting energy to give the daily maintenance estimate. Tare uses four levels with plain names:

   | UI name | Multiplier | Meant for | Example |
   |---|---|---|---|
   | Sedentary | 1.2 | Desk work, little walking | Desk work, driving, TV |
   | Lightly Active | 1.375 | On your feet part of the day | On your feet part of the day, light chores |
   | Moderately Active | 1.55 | Physical job or on your feet most of the day | A physical job or on your feet most of the day |
   | Very Active | 1.725 | Hard physical work all day | Hard physical work all day |

   The screen calls this Baseline Activity Level. The activity level describes the kind of job and ordinary day the member has, without workouts. Workouts are credited separately (decision 7), which the chooser says out loud so the same run is never counted twice.

   The chooser shows what each level would add to a day rather than the multiplier it comes from, because a multiplier is a name nobody is told (decision 29): resting energy x (multiplier - 1), rounded to the nearest ten and read as "adds about 730 cal". Without sex, height and a weight there is no resting figure, so no level carries a number.
   Why: the multipliers are the convention used across consumer apps and clinical calculators. Their exact provenance is UNVERIFIED; they are consistent with the physical activity level (PAL) bands in the FAO/WHO/UNU energy requirements report (sedentary 1.40 to 1.69, active 1.70 to 1.99, vigorous 2.00 to 2.40) [6] and with the physical-activity coefficients in the Dietary Reference Intakes energy chapter (sedentary, low active, active, very active). [7] Keeping workouts out of the level is what stops the same run from being counted twice.

6. The default activity level when the member has not chosen one is Not much (1.2).
   Why: people overstate their activity, and a budget that runs high is the common way calorie apps fail. Exercise still earns credit when it is logged, so an active member is not penalised. The overstatement claim is UNVERIFIED as a cited finding and is stated here as a product decision.

7. Exercise credit: a logged workout adds its net calories to that day's budget. For a manual entry the net figure is (MET - 1) x 3.5 x weight(kg) / 200 x minutes, using the MET value from the 2024 Adult Compendium of Physical Activities. [8] For a workout that arrived from a phone with its own calorie figure (Round 9), that figure is used as reported and treated as net. A manual entry and an imported workout that overlap in time count once, the imported one wins.
   Why: the Compendium defines 1 MET as 3.5 mL of oxygen per kg per minute, about 1 kcal per kg per hour. [8] Subtracting 1 MET is Tare's own step, not the Compendium's: it removes the resting energy the body would have spent anyway, which is already inside the resting estimate, so the credit is not counted twice. Apple's active energy and Health Connect's active calories are both defined as energy above resting, so they are already net. Consumer wearables misestimate energy expenditure by a wide margin (median errors of 27 to 93 percent across seven devices in one validation), [9] so Tare shows the credit as an estimate and never as a precise number.

8. Daily step-driven active energy from a phone or watch is displayed in the Move tab but is never added to the budget in version 1.
   Why: the activity level already covers everyday movement, so crediting step energy on top of it double counts. A device-driven mode that replaces the activity level with measured active energy is a post-v1 question.

### Defaults with no profile

9. Until the member has entered sex, height and weight, the app uses fixed guideline targets for a healthy adult at 2,000 kcal:

   | Target | Value | Basis |
   |---|---|---|
   | Calories | 2,000 kcal | Reference intake used for Daily Values on the Nutrition Facts label [10] |
   | Protein | 100 g (20 percent) | Inside the 10 to 35 percent acceptable range [7]; equals 1.4 g/kg for a 70 kg adult, the low end of the range recommended for active adults [11] |
   | Carbohydrate | 250 g (50 percent) | Inside the 45 to 65 percent acceptable range [7] |
   | Fat | 67 g (30 percent) | Inside the 20 to 35 percent acceptable range [7] |
   | Fiber | 28 g | Daily Value at 2,000 kcal [10], which follows 14 g per 1,000 kcal [7] |
   | Saturated fat, ceiling | 20 g | Under 10 percent of calories [12]; Daily Value 20 g [10] |
   | Added sugars, ceiling | 36 g | American Heart Association: no more than 25 g a day for women and 36 g for men [31]. The higher of the two stands while sex is unknown, so Tare never sets a lower ceiling than the member's own would be |
   | Sodium, ceiling | 2,300 mg | Dietary Guidelines limit for ages 14 and over [12]; Daily Value 2,300 mg [10] |
   | Cholesterol, ceiling | 300 mg | Daily Value [10] |

   Why: the Nutrition Facts Daily Value for protein is 50 g, [10] which equals the Recommended Dietary Allowance of 0.8 g/kg for a 62.5 kg adult. [7] The RDA is the amount that prevents deficiency in nearly all healthy adults, not an optimum. The 2025-2030 Dietary Guidelines now give a general-population target of 1.2 to 1.6 g/kg, [12] and position stands for active and older adults sit in the same territory. [11][13] 100 g at 2,000 kcal equals 1.4 g/kg for a 70 kg adult, the middle of the federal range, and stays inside the acceptable range. Carbohydrate and fat then split the remaining 1,600 kcal near the middle of their ranges.

### Macros with a profile

10. Once a profile exists, protein is set in grams per kilogram of current weight by goal, then clamped to the 10 to 35 percent acceptable range: [7]

   | Goal | Protein | Source |
   |---|---|---|
   | Maintain | 1.4 g/kg | Middle of the 1.2 to 1.6 g/kg general-population target in the 2025-2030 Dietary Guidelines [12]; equals the no-profile default of 100 g at 2,000 kcal for a 70 kg adult, so adding a profile never lowers the number |
   | Lose weight | 1.6 g/kg | Top of the federal range [12] and inside the 1.4 to 2.0 g/kg the ISSN gives for exercising adults [11]. The ISSN's figure for keeping lean mass in a deficit is 2.3 to 3.1 g/kg, but that is for resistance-trained people; [11] 1.6 is Tare's practical pick for general adults, a product decision |
   | Gain weight or muscle | 1.6 g/kg | Muscle gain with resistance training showed a break point at 1.62 g/kg (95 percent interval 1.03 to 2.20); the segmented fit did not reach significance (p = 0.079), so this is a best estimate, not a hard plateau [15] |
   | Any goal, age 65 and over | at least 1.2 g/kg | PROT-AGE: 1.0 to 1.2 g/kg for healthy older adults, at least 1.2 g/kg for those who exercise [13] |

   Fat is then 30 percent of the budget (inside 20 to 35 percent) [7] and carbohydrate takes the remainder. If carbohydrate would fall below 130 g, the RDA, [7] the Targets page notes it in one sentence and offers the manual adjustment fold.
   Why: a grams-per-kilogram protein figure follows the evidence, which is expressed per kilogram, while a fixed percentage split gives small people too little protein and large people too much. [11][12] The joint ACSM, Academy and Dietitians of Canada position is reported as 1.2 to 2.0 g/kg for active people; [14] its full text was not reachable, so that range is UNVERIFIED here and nothing rests on it alone.

10b. The Protein, Carbs and Fat split can be set three ways, and the automatic arithmetic in decision 10 is unchanged by the other two:

   | Way | Calories | Split |
   |---|---|---|
   | Automatic | The budget from decisions 13 to 17 | Decision 10 |
   | Percentages | The same budget | Three whole percentages the member sets, each 5 to 70, adding to 100. Grams are percentage x calories / 4 for protein and carbohydrate and / 9 for fat |
   | Grams | Typed by the member | Typed by the member |

   Three starting points fill the percentage fields. They are a convenience, never the automatic answer, and the member saves them like any other split:

   | Starting point | Protein | Carbs | Fat |
   |---|---|---|---|
   | Lose weight | 35 | 35 | 30 |
   | Maintain | 30 | 40 | 30 |
   | Gain weight | 35 | 45 | 20 |

   The losing split stops at 35 percent protein, which is the top of the acceptable range, [7] and the screen says "Protein is held at the top of the recommended range." Nothing is clamped after a member has set their own percentages: they were held to their bounds when they were accepted, and moving them afterwards would make the screen disagree with itself.
   Why: a per-kilogram rule is the honest default (decision 10), but somebody following a plan written in percentages should not have to convert it by hand, and somebody who already knows their grams should not have to reach them through a percentage. The ceilings in decision 12 stay automatic in all three ways, because they are guideline limits rather than a target anybody picks.

11. For members with a body mass index of 30 or more, the protein calculation uses current weight but the 35 percent clamp applies first, so protein never exceeds 35 percent of the budget. [7]
   Why: per-kilogram rules scaled to a high body weight can produce intakes above the acceptable range; the clamp keeps the target inside guideline bounds without a second body-weight adjustment the member would have to understand.

12. Fiber target with a profile: 14 g per 1,000 kcal of the budget, the basis of the fiber Adequate Intake. [7] (The 14 g per 1,000 kcal derivation lives in the report text, which was not reachable; the published Adequate Intakes of 38 g for men and 25 g for women were confirmed. UNVERIFIED as a quoted line.) Saturated fat ceiling: 10 percent of the budget. [12] Added sugars ceiling: 25 g a day for female members and 36 g for male members, the American Heart Association's figures, [31] and 36 g while sex is unknown. It is a fixed figure and not a share, so it does not move with the budget. The 10 percent of calories basis is not used: the 2025-2030 Dietary Guidelines dropped the percentage and say only that added sugars are not recommended, [12] and the label's 50 g Daily Value is that same dropped percentage written at 2,000 kcal. [10] Sodium ceiling: 2,300 mg regardless of budget. [12]

### Weight change

13. Weight loss rate is set with a stepper, and all three steps are offered to every member:

   | Step | Rate | Deficit |
   |---|---|---|
   | 1 (default) | 0.45 kg (1 lb) per week | 450 kcal/day |
   | 2 | 0.7 kg (1.5 lb) per week | 700 kcal/day |
   | 3 | 0.9 kg (2 lb) per week | 900 kcal/day |

   Under the stepper the screen shows a "Goal rate review" note, picked from the rate against the latest weigh-in:
   - Step 1: "A steady pace most people can keep up. Slower loss tends to hold on to more muscle."
   - Steps 2 and 3 at or under 1 percent of the member's weight a week, and either step before the first weigh-in: "This makes a bigger gap between what you consume and what you use. It works for some, but many find it hard to keep up. Watch how you feel and ease back if it stops feeling right."
   - Steps 2 and 3 over 1 percent of the member's weight a week: "This is faster than about 1 percent of your weight a week. Loss this quick is often water rather than fat, and makes it easier to lose muscle and miss out on nutrients. Most guidance stops at 2 lb a week."

   Why: the BMI 35 gate that used to hold back the two faster rates is retired, his call of 2026-09-02. It sorted members by a number the app never shows them (decision 29) and refused a pace to the person it was hardest to explain the refusal to. What replaces it is a tiered note that says what a fast loss costs, plus the two guardrails that were always the real ones: the 25 percent cap of decision 14 and the floors of decision 15, both of which ease a chosen step back and say so. The NHLBI clinical guidelines still bound the top of the list: 500 to 1,000 kcal/day, 1 to 2 lb per week, is the fastest they describe, [16] and 0.9 kg a week is inside it. Athletes aiming at 0.7 percent of body weight per week (and achieving it) kept more lean mass than those aiming at 1.4 percent (achieving about 1.0), [19] which is why step 1 is the default and why the tier that warns starts at 1 percent. The CDC's 1 to 2 lb per week page could not be reached (UNVERIFIED). [17] NICE's current guideline NG246 gives no weekly rate; the 0.5 to 1 kg per week figure belonged to the withdrawn CG189. [18] The third tier's sentence about water, muscle and nutrients is UNVERIFIED product wording: the ACSM 2009 position stand (Donnelly et al., Med Sci Sports Exerc 41(2):459) was the intended citation, and on 2026-09-02 its DOI redirected to a paywall (HTTP 402) and PubMed refused the abstract, so nothing was read and nothing is cited for it.

14. The deficit is capped at 25 percent of the maintenance estimate. A chosen rate that needs more than that is reduced to the cap and the Targets page says so in one sentence.
   Why: the guideline deficits above assume a typical adult; for a small or light person 1,000 kcal/day is a far larger fraction of maintenance than it is for a large one. A percentage cap keeps the deficit proportional. The 25 percent figure is a product decision informed by the lean-mass finding, [19] not a guideline number.

15. Calorie floors: the budget never goes below 1,200 kcal for female members or 1,500 kcal for male members, whatever the goal. If the floor binds, the budget sits at the floor, the projected rate is recalculated from the deficit that remains, and the Targets page says the goal will take longer than the chosen pace.
   Why: the NHLBI guidelines describe low-calorie diets of 1,000 to 1,200 kcal/day for women and 1,200 to 1,500 kcal/day for men as a choice made with a clinician, [16] so an unsupervised app should not set budgets below the upper edge of those ranges. The floors sit exactly at those upper edges. They are also the common convention among calorie apps.

16. The budget may fall below the resting estimate when the floor allows it. Tare does not refuse that; it applies the floor and the 25 percent cap instead.
   Why: guideline deficits routinely produce budgets under resting rate for heavier members, and refusing them would block the guideline itself.

17. Weight gain rate is set the same way, with two steps:

   | Step | Rate | Surplus |
   |---|---|---|
   | 1 (default) | 0.25 kg (0.5 lb) per week | 250 kcal/day |
   | 2 | 0.45 kg (1 lb) per week | 450 kcal/day |

   Its review note is one sentence at either step: "A small, steady gain keeps more of it as muscle."

   Why: for muscle gain a surplus of roughly 10 to 20 percent above maintenance, giving 0.25 to 0.5 percent of body weight per week, is the recommendation that limits fat gain. [20] A surplus is also capped at 20 percent of maintenance.

18. Projected goal date: weeks to goal = (current trend weight - goal weight) / chosen weekly rate, from today. The UI says "At this pace, about [Month Year]" with the month only, never a day, and adds "Bodies adapt, so the real date is usually later. The estimate updates as you weigh in."
   Why: the 3,500 kcal per pound rule [21] treats loss as linear, but validated dynamic models show a deficit produces a slowing curve as the body adapts, with about half the eventual change reached after a year. [22] Weight loss also lowers resting energy more than the weight change alone predicts, an effect measured years later in one cohort. [23] A month-level date with honest wording is as precise as the math allows.

19. Trend weight is an exponentially weighted moving average of daily weigh-ins with a smoothing factor of 0.1, seeded with the first weigh-in. Days without a weigh-in carry the previous trend value. The trend, not the latest reading, drives the goal projection and the Targets page; single weigh-ins are shown as light points around the trend line.
   Why: day-to-day scale readings move by a kilogram or more with water and food, so single readings mislead; the exponentially smoothed trend is the long-standing method for consumer weight tracking. [24] That source states its smoothing constant as 0.9, the weight kept from yesterday's trend, which is the same rule written as trend = trend + 0.1 x (today - trend); it describes it as roughly a 20-day simple average. A convention, not a guideline number.

20. Re-estimation from actual results: after 28 days of trend data, if the trend slope differs from the chosen rate by more than 50 percent while the member logged food on at least 5 days a week, the Targets page shows one sentence offering to adjust the budget by the difference between expected and observed change, using 7,700 kcal per kilogram of difference over the period. The offer is never applied automatically and never breaks the floor or the cap.
   Why: adaptive thermogenesis and logging error both make the starting estimate drift; correcting from observed change is what the dynamic models do. [22] The 7,700 kcal per kilogram figure is the same rule of thumb as 3,500 kcal per pound [21] and is used here only to size a correction, never to promise a date.

### Guardrails

21. Tare is for adults 18 and over. Birthdate is required at registration and checked on the server. Under 18 is refused with "Tare is for adults 18 and over." Existing accounts without a birthdate are asked at next sign-in.
   Why: the energy equations were derived in adults, [1] and the product owner's decision is adults only. The minimum-age policies of MyFitnessPal, Cronometer, Lose It and Noom are UNVERIFIED and are not relied on.

22. Clinician nudge, shown once per trigger as a calm sentence with a Dismiss action, never a modal:
   - Current BMI under 18.5 with a weight-loss goal: "Your details put you below the healthy weight range. Talk to a clinician before aiming lower." The loss goal is not blocked; the nudge stays on the Targets page while the condition holds.
   - Goal weight that would give a BMI under 18.5: the goal is accepted but the same sentence appears and the goal date is not shown.
   - BMI of 40 or more: "A clinician can help plan safely at this weight. Tare is only an estimate."
   Why: the WHO defines adult underweight as a BMI under 18.5 in its indicator set and overweight and obesity at 25 and 30 on its fact sheet; [25] the 40 threshold is obesity class III in the NHLBI classification table. [16] Eating-disorder red flags cannot be detected from a calorie budget, so the app does not attempt it; the disclaimer (decision 30) and the floors are the protection.

23. BMI is computed on the server for the guardrails and shown on the Profile screen as a plain number with no category word; it is never shown on any other screen. Body-fat percentage is shown as the member's own recorded number without a category label.
   Why: BMI does not distinguish fat from lean mass and its bands differ by population, [25][26] and a category label on a first screen is the opposite of the calm, non-judging tone the product owner asked for. This is a product decision; the ACE body-fat bands [27] are recorded for a future opt-in view only and are UNVERIFIED, since the cited page no longer exists at its address.

24. Pregnancy and breastfeeding: the profile has an off-by-default switch, "Pregnant or breastfeeding". While on, weight-loss goals are unavailable, the budget is the maintenance estimate with no deficit, the Targets page says "Energy needs change during pregnancy and breastfeeding. Ask your clinician what is right for you," and no additional calories are added.
   Why: the Dietary Reference Intakes add about 340 kcal/day in the second trimester, 452 kcal/day in the third, and about 330 kcal/day in the first six months of breastfeeding [7] (report text, not reachable by fetch, UNVERIFIED as quoted), and the pregnancy weight guidelines recommend gain in every BMI class rather than loss. [28] Adding those calories automatically would require trimester tracking that Tare does not do; blocking loss and handing the number to a clinician is the honest version-1 behaviour.

25. Profile fields and fallbacks:

   | Field | Required for a personal estimate | Fallback when missing |
   |---|---|---|
   | Birthdate | Yes (also required by decision 21) | None; registration refuses without it |
   | Sex | Yes | Fixed 2,000 kcal defaults (decision 9) |
   | Height | Yes | Fixed 2,000 kcal defaults |
   | Weight | Yes; latest weigh-in wins | Fixed 2,000 kcal defaults |
   | Activity level | No | Not much (decision 6) |
   | Goal rate | No | The first step for the direction: 0.45 kg a week losing, 0.25 kg a week gaining |
   | Body fat | No | Mifflin-St Jeor instead of Cunningham (decision 2) |
   | Goal weight | No | No projection shown, and the day is a maintaining one (decision 31) |

   Why: the equation needs all four of sex, height, weight and age; [1] everything else has a safe default that a non-tracker never has to touch.

26. Units: weight entered in pounds is stored as kilograms at 0.45359237 kg per pound; height entered in feet and inches is stored as centimetres at 2.54 cm per inch. All math runs in kilograms and centimetres; display converts back.

27. Privacy: birthdate, sex, height, weight, body fat, activity level, goals, targets and every computed number are private to the member. No other member and no administrator can see them. The only profile facts a member may choose to show others are age in years, sex, and City, State, each behind its own switch that is off by default.
   Why: health data is a special category under the GDPR, [29] and in the United States the FTC's Health Breach Notification Rule exists precisely because health apps outside HIPAA have no HIPAA protection, [30] which means the app's own design is the main protection a member has. Private by default is the design.

28. Every computed number rounds for display: calories to the nearest 10, grams to the nearest 1, percentages to the nearest 1. Internal values keep full precision.
   Why: a budget of 1,847 kcal claims a precision the equation does not have. [2]

29. Formula names (Mifflin-St Jeor, Cunningham, MET, PAL, BMI, AMDR, TDEE, BMR) never appear in the UI, with one exception: the At rest helper on the Activity Levels screen may say "Sometimes called basal metabolic rate" once, because it is the name a member is most likely to have met elsewhere and to be looking for. Every other formula name stays out. They live in this document and in the Guide page under a "Where the numbers come from" heading for members who want them.

30. Disclaimer, shown once on the Targets page the first time a budget is computed, and always reachable from the Guide:
   "Tare estimates. It is not medical advice. The numbers come from population averages and can be off by a few hundred calories for any one person. Talk to a clinician before changing how you eat if you are pregnant or breastfeeding, under care for a medical condition, or have a history of disordered eating."

31. Goal direction is inferred from the two weights and never chosen. A goal weight under the latest weigh-in is a losing plan, one above it is a gaining plan, and no goal weight, no weigh-in, or the two the same is maintaining. There is no Lose / Maintain / Gain chooser anywhere, and no goal is stored: the two weights are the only record of it. The latest weigh-in rather than the trend weight (decision 19), so the direction agrees with the number the member is looking at. A goal weight that turns the direction around drops the stored goal rate, because a rate belongs to the direction it was picked under.
   Why: his call of 2026-09-02. A member who has typed both weights has already said which way they are going, and asking again is a second answer that can disagree with the first.

## Plain-language phrasing

| Concept | Words the UI uses | Words the UI never uses |
|---|---|---|
| Resting energy expenditure | "At rest", "what your body uses at rest", and once, in the helper under it, "Sometimes called basal metabolic rate" | RMR, REE, basal (BMR only in that one helper) |
| Total daily energy expenditure | "your daily budget", "about what you use in a day", the Activity Levels screen's "About what you use today" | TDEE, maintenance calories, total daily energy expenditure |
| Activity multiplier | "Baseline Activity Level" with Sedentary / Lightly Active / Moderately Active / Very Active, each with what it adds to the day | PAL, multiplier, activity factor |
| Energy spent digesting food | not shown | TEF, thermic effect of food |
| The three of them together | "Protein, Carbs and Fat", set Automatic, by Percentages or in Grams | macro split, macro ratio, IIFYM |
| MET-based exercise calories | "Exercise added back" | MET, metabolic equivalent |
| Calorie deficit | "eating a bit less than you use" | deficit, caloric restriction |
| Calorie surplus | "eating a bit more than you use" | surplus, bulk |
| Macronutrients | "Protein, Carbs, Fat" | macros, macronutrients |
| AMDR | "the range experts recommend" | AMDR, acceptable distribution |
| Grams per kilogram protein | "protein for your size" | g/kg, per kilogram |
| Calorie floor | "the lowest budget Tare will set" | floor, minimum intake, VLCD |
| Trend weight | "your trend" | EWMA, moving average, smoothed |
| Projected goal date | "At this pace, about [Month Year]" | projection, ETA, linear estimate |
| BMI | not shown | BMI, body mass index, obese, overweight, underweight |
| Body fat percentage | "body fat" with the member's own number | essential fat, athlete range, obese |
| Sex field | "Sex", Female / Male, "Used only to estimate how much energy your body uses" | gender, biological sex |
| Clinician nudge | "Talk to a clinician" | doctor's orders, medical warning, risk |
| Missing profile | "Add your details for a personal number" | incomplete profile, error |

## Open questions

Each item is a decision for the product owner. The default in the Decisions section stands until changed.

1. Exercise credit fraction (decision 7): Tare credits 100 percent of net exercise calories. MyFitnessPal is widely criticised for the same full credit because device estimates run high. [9] Alternative: credit 50 percent by default with a "count all of it" switch on the Targets page. Recommendation: keep 100 percent of the net figure for manual entries (the MET math is already conservative) and revisit for imported workouts in Round 9 when real device numbers are visible.
2. Calorie floors (decision 15): decided 2026-09-01, 1,200 for women and 1,500 for men, the upper edges of the NHLBI ranges. [16]
3. Default activity level (decision 6): Not much (1.2) is the conservative pick. Alternative: Light (1.375), which better matches a person who walks a fair amount but does not exercise. The cost of the wrong pick is a budget about 200 kcal too high or too low.
5. Pregnancy switch (decision 24): included as a profile switch. Alternative: leave it out of version 1 and let the disclaimer carry it.
6. Maintain protein (decision 10): decided 2026-09-01, 1.4 g/kg, the middle of the federal range. [12]
9. Faster rates gated on BMI 35 (decision 13): decided 2026-09-01, the gate stays; it is what the source says. [16] The Targets page explains it in one sentence.
10. Added sugars ceiling (decisions 9 and 12): decided 2026-09-02, the American Heart Association's 25 g for women and 36 g for men, [31] and 36 g while sex is unknown. The 10 percent of calories basis is dropped with the percentage the Dietary Guidelines withdrew. [12]
7. Activity multiplier provenance (decision 5): the 1.2 to 1.9 set is a convention with no primary source found. Alternative: use the DRI physical-activity coefficients directly inside the DRI estimated energy requirement equations, [7] which have a documented derivation but are less familiar and give slightly different numbers.
8. Older-adult protein (decision 10): PROT-AGE's 1.0 to 1.2 g/kg is a floor for age 65 and over, with at least 1.2 g/kg for those who exercise. [13] Its 1.2 to 1.5 g/kg band is for acute or chronic illness, which Tare cannot know about. The 1.2 minimum stands.

## Sources

1. Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. A new predictive equation for resting energy expenditure in healthy individuals. American Journal of Clinical Nutrition, 1990. https://doi.org/10.1093/ajcn/51.2.241. Accessed 2026-09-01. Equation coefficients and the age range of the derivation sample.
2. Frankenfield D, Roth-Yousey L, Compher C. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review. Journal of the American Dietetic Association, 2005. https://doi.org/10.1016/j.jada.2005.02.005. Accessed 2026-09-01. Accuracy of Mifflin-St Jeor versus Harris-Benedict and others.
3. Cunningham JJ. Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation. American Journal of Clinical Nutrition, 1991. https://doi.org/10.1093/ajcn/54.6.963. Accessed 2026-09-01. The 370 + 21.6 x lean mass equation, also known as Katch-McArdle.
4. Harris JA, Benedict FG. A biometric study of human basal metabolism. Proceedings of the National Academy of Sciences, 1918. https://doi.org/10.1073/pnas.4.12.370. Accessed 2026-09-01. Original equation, not used.
5. Roza AM, Shizgal HM. The Harris Benedict equation reevaluated: resting energy requirements and the body cell mass. American Journal of Clinical Nutrition, 1984. https://doi.org/10.1093/ajcn/40.1.168. Accessed 2026-09-01. Revised equation, not used.
6. FAO/WHO/UNU. Human energy requirements: report of a joint expert consultation. FAO Food and Nutrition Technical Report Series 1, 2004. https://www.fao.org/3/y5686e/y5686e00.htm. Accessed 2026-09-01. PAL bands for sedentary, active and vigorous lifestyles.
7. Institute of Medicine. Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids. National Academies Press, 2005. https://doi.org/10.17226/10490. Accessed 2026-09-01. AMDR ranges, protein RDA 0.8 g/kg, carbohydrate RDA 130 g, fiber 14 g per 1,000 kcal, physical-activity coefficients, pregnancy and lactation energy additions.
8. Herrmann SD, Willis EA, Ainsworth BE, et al. 2024 Adult Compendium of Physical Activities. Journal of Sport and Health Science, 2024, with the Compendium site https://pacompendium.com/. The 2011 edition (Ainsworth et al., https://doi.org/10.1249/MSS.0b013e31821ece12) is superseded. Accessed 2026-09-01. MET values and the definition 1 MET = 3.5 mL O2/kg/min, about 1 kcal/kg/hour. The (MET - 1) net correction is not stated by the Compendium; it is Tare's own step.
9. Shcherbina A, Mattsson CM, Waggott D, et al. Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a diverse cohort. Journal of Personalized Medicine, 2017. https://doi.org/10.3390/jpm7020003. Accessed 2026-09-01. Energy expenditure error range across consumer wearables.
10. US Food and Drug Administration. Daily Value on the Nutrition and Supplement Facts Labels, and 21 CFR 101.9(c)(9). https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels and https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9. Accessed 2026-09-01. Daily Values at 2,000 kcal: fat 78 g, saturated fat 20 g, cholesterol 300 mg, sodium 2,300 mg, carbohydrate 275 g, fiber 28 g, added sugars 50 g, protein 50 g.
11. Jager R, Kerksick CM, Campbell BI, et al. International Society of Sports Nutrition position stand: protein and exercise. Journal of the International Society of Sports Nutrition, 2017. https://doi.org/10.1186/s12970-017-0177-8. Accessed 2026-09-01. 1.4 to 2.0 g/kg for active adults; higher intakes during energy restriction.
12. US Department of Health and Human Services and US Department of Agriculture. Dietary Guidelines for Americans, 2025-2030. Published 2026-01-07. https://cdn.realfood.gov/DGA.pdf (portal https://www.realfood.gov/). Accessed 2026-09-01. Protein target 1.2 to 1.6 g per kg of body weight per day; saturated fat not to exceed 10 percent of calories; sodium under 2,300 mg per day for ages 14 and over; added sugars "not recommended" with no percentage limit. Supersedes the 2020-2025 edition, whose 10 percent added-sugars limit is therefore no longer current guidance.
13. Bauer J, Biolo G, Cederholm T, et al. Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group. Journal of the American Medical Directors Association, 2013. https://doi.org/10.1016/j.jamda.2013.05.021. Accessed 2026-09-01. 1.0 to 1.2 g/kg for healthy older adults; at least 1.2 g/kg for those who exercise; 1.2 to 1.5 g/kg for acute or chronic disease.
14. Thomas DT, Erdman KA, Burke LM. Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: nutrition and athletic performance. Journal of the Academy of Nutrition and Dietetics, 2016. https://doi.org/10.1016/j.jand.2015.12.006. Accessed 2026-09-01. Reported as 1.2 to 2.0 g/kg protein for active people; the full text was not reachable, so UNVERIFIED.
15. Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. British Journal of Sports Medicine, 2018. https://doi.org/10.1136/bjsports-2017-097608. Accessed 2026-09-01. Break point 1.62 g/kg (95 percent interval 1.03 to 2.20); the segmented regression did not reach significance (p = 0.079).
16. National Heart, Lung, and Blood Institute. Clinical Guidelines on the Identification, Evaluation, and Treatment of Overweight and Obesity in Adults: The Evidence Report. NIH Publication 98-4083, 1998. https://www.nhlbi.nih.gov/files/docs/guidelines/ob_gdlns.pdf. Accessed 2026-09-01. Deficit of 300 to 500 kcal/day for a BMI of 27 to 35 and 500 to 1,000 kcal/day for a BMI above 35 (1 to 2 lb/week); low-calorie diet ranges 1,000 to 1,200 kcal (women) and 1,200 to 1,500 kcal (men); initial goal of 10 percent loss over 6 months; BMI classification table with underweight under 18.5 and obesity class III at 40 and over.
17. Centers for Disease Control and Prevention. Steps for losing weight. https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html. Attempted 2026-09-01, page returned 403 and no archive copy was found. Gradual loss of 1 to 2 lb per week. UNVERIFIED.
18. National Institute for Health and Care Excellence. Overweight and obesity management (NG246, published 2025-01-14, updated 2026-01-08, replacing CG189). https://www.nice.org.uk/guidance/ng246. Accessed 2026-09-01. Gives no weekly rate; its diet advice is to keep energy intake below expenditure. The 0.5 to 1 kg per week figure came from the withdrawn CG189 (2014) and is recorded here as history, not current guidance.
19. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. International Journal of Sport Nutrition and Exercise Metabolism, 2011. https://doi.org/10.1123/ijsnem.21.2.97. Accessed 2026-09-01. Groups aimed at 0.7 and 1.4 percent of body weight per week (achieved 0.7 and about 1.0); lean mass rose 2.1 percent in the slow group and was unchanged in the fast group.
20. Iraki J, Fitschen P, Espinar S, Helms E. Nutrition recommendations for bodybuilders in the off-season: a narrative review. Sports, 2019. https://doi.org/10.3390/sports7070154. Accessed 2026-09-01. Surplus of 10 to 20 percent, gain of 0.25 to 0.5 percent of body weight per week.
21. Wishnofsky M. Caloric equivalents of gained or lost weight. American Journal of Clinical Nutrition, 1958. https://doi.org/10.1093/ajcn/6.5.542. Accessed 2026-09-01. Origin of the 3,500 kcal per pound rule.
22. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. The Lancet, 2011. https://doi.org/10.1016/S0140-6736(11)60812-X. Accessed 2026-09-01. Dynamic model; about half of the eventual weight change reached after one year; roughly 10 kcal/day per pound of eventual change. Companion tool: NIH Body Weight Planner, https://www.niddk.nih.gov/bwp.
23. Fothergill E, Guo J, Howard L, et al. Persistent metabolic adaptation 6 years after "The Biggest Loser" competition. Obesity, 2016. https://doi.org/10.1002/oby.21538. Accessed 2026-09-01. Resting metabolic rate remained suppressed years after large weight loss.
24. Walker J. The Hacker's Diet. 1991, online edition. https://www.fourmilab.ch/hackdiet/. Accessed 2026-09-01. Exponentially smoothed moving average of daily weights with a 0.1 factor. Secondary source; the method is a convention.
25. World Health Organization. Obesity and overweight fact sheet, https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight, and the Global Health Observatory body-mass-index indicator, https://www.who.int/data/gho/data/themes/topics/topic-details/GHO/body-mass-index. Accessed 2026-09-01. Overweight at 25 and over and obesity at 30 and over (fact sheet); adult underweight under 18.5 (indicator). The fact sheet carries no class III band; the 40 threshold is taken from source 16.
26. WHO Expert Consultation. Appropriate body-mass index for Asian populations and its implications for policy and intervention strategies. The Lancet, 2004. https://doi.org/10.1016/S0140-6736(03)15268-3. Accessed 2026-09-01. Population-specific BMI action points; a limit of BMI as a universal category.
27. American Council on Exercise. Percent body fat norms for men and women. https://www.acefitness.org/resources/everyone/blog/112/what-are-the-guidelines-for-percentage-of-body-fat-loss/. Attempted 2026-09-01, the address now redirects to the blog index; UNVERIFIED. Body-fat bands as commonly reproduced (women: essential 10 to 13, athletes 14 to 20, fitness 21 to 24, acceptable 25 to 31, obesity 32 and over; men: essential 2 to 5, athletes 6 to 13, fitness 14 to 17, acceptable 18 to 24, obesity 25 and over). Recorded for a future opt-in view only.
28. Institute of Medicine. Weight Gain During Pregnancy: Reexamining the Guidelines. National Academies Press, 2009. https://doi.org/10.17226/12584. Recommended gestational weight-gain ranges for every pre-pregnancy BMI class, none of which is a loss. Not fetched, UNVERIFIED as quoted. The ACOG FAQ on weight gain during pregnancy (https://www.acog.org/womens-health/faqs/weight-gain-during-pregnancy) was cited first but the page no longer exists at that address.
29. Regulation (EU) 2016/679 (GDPR), Article 9. https://gdpr-info.eu/art-9-gdpr/. Accessed 2026-09-01. Health data is a special category of personal data.
30. Federal Trade Commission. Health Breach Notification Rule, final rule of 2024-04-26. https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule and https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule. Accessed 2026-09-01. The rule applies to "health apps and similar technologies not covered by HIPAA" and to vendors of personal health records. The HHS guidance page on HIPAA and health apps (https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html) returned 403 from every route, so the HHS half is UNVERIFIED. Whether a self-hosted private instance falls under the FTC rule is the author's reading, not the FTC's words.
31. Johnson RK, Appel LJ, Brands M, et al. Dietary sugars intake and cardiovascular health: a scientific statement from the American Heart Association. Circulation, 2009;120:1011-1020. https://doi.org/10.1161/CIRCULATIONAHA.109.192627. Accessed 2026-09-02. Upper limit for added sugars of about 100 kcal a day for most women and about 150 kcal a day for most men, which is 25 g and about 36 g.
