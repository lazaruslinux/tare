# Tare

Tare is a food journal and health tracker with a community-built food database. The database starts completely empty. Every food in it was entered by a member and checked by a person before it was published, so the database grows more useful the longer Tare has been running and the less it resembles a generic product catalogue.

Scanning a barcode is the only online step a member ever sets off. A code nobody has entered yet is asked of an online source, and what comes back waits for a reviewer to approve it before it joins the shared database. The one other lookup belongs to an administrator: a food that is already approved can have its vitamins and minerals matched by name against USDA FoodData Central, and an administrator picks the right record by hand. Nothing else leaves the server, and nothing enters the database without a person deciding it should.

Beside the journal, Tare records weight, exercise, and the step and workout data a phone sends in, and shows a read-only feed of what the friends you choose have logged. Accounts are created by invitation.

Tare is open source under the AGPL and can be self-hosted; see Running it below.

This project was built with Claude Code, an agentic coding platform, through hundreds of human iterations and thousands of prompts.

## Status

Early development, and most of it is running. Accounts come from an invite link that carries one to ten seats, an emailed verification stands in front of the app until the address is confirmed, and a guided setup and a welcome tour start a member off. The journal takes private custom foods, meals, recipes, daily foods that log themselves, and a day that can be marked complete. The shared database is browsed by aisle or found by barcode with the camera, carries label photos, takes reports on anything wrong with a food, and everything joining it passes an approval queue worked by two roles, administrator and reviewer, whose every decision is written to a review log. Foods carry vitamins and minerals per serving, filled from an administrator's USDA match picker where a barcode did not supply them. Calorie and macro targets are worked out from a weight goal, with weigh-ins and body measurements behind them. Health sync brings in what a phone records, through Health Auto Export or an uploaded file, and workouts arrive with their routes and an optional map. Beside all of that: a library of stretches and moves, member profiles with avatars, friends by mutual request, a read-only community feed with a sharing switch over every part of it, and a feedback line to the administrator. It installs as a PWA.

## Running it

```
cp .env.example .env
```

Edit `.env` and replace the placeholders, at minimum `POSTGRES_PASSWORD` and `SECRET_KEY`. The api refuses to start while either is still the example value, and Postgres only reads its password the first time it creates the data directory, so set it before the first start.

```
docker compose up -d --build
```

The api listens on `127.0.0.1:8200` and the web front end on `127.0.0.1:8210`. The development override file also publishes Postgres on `127.0.0.1:55434` and runs Mailpit on `127.0.0.1:8225`, a mail catcher that accepts every message the api sends and delivers none of them; delete or rename that file on a deployment. Nothing is published beyond loopback, so reaching an instance from elsewhere means putting a reverse proxy in front of it.

For a real deployment, with the proxy, the first account, backups and what each setting does, see [docs/DEPLOY.md](docs/DEPLOY.md).

To work on the front end against a running api:

```
cd frontend && npm install && npm run dev
```

That serves on port 5190 and forwards `/api` to `127.0.0.1:8200`.

## Checks

The backend, in a Python 3.13 virtual environment:

```
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install --require-hashes -r requirements.txt
pip install -r requirements-dev.txt
ruff check . && mypy && pytest -q
```

Then the dependency audit, which reads the locked runtime list rather than what is installed:

```
pip install pip-audit
pip-audit --no-deps -r requirements.txt
```

The front end:

```
cd frontend
npm ci && npm run lint && npm run build && npm audit --omit=dev
```

CI runs the same commands on every push.

## Data sources

The barcode scanner first searches the Tare database for existing items. If it doesn't exist, it searches Open Food Facts, whose data is available under the Open Database License (ODbL). Once an item is approved, it's stored on Tare's server and doesn't have to reach out to the internet.

Vitamins and minerals can also come from USDA FoodData Central, which is public domain. Only an administrator reaches it, and only to match a food that is already approved and has no vitamins on it yet; a member's scan never does, and an instance without a FoodData Central key never does at all.

Calorie and nutrient targets follow the Dietary Guidelines for Americans and the American Heart Association. Tare uses math to make estimates, and does not provide medical advice. Talk to your doctor/clinician before changing how you eat, especially if pregnant, breastfeeding, under care for a medical condition, or have a history of eating disorders.

## License

AGPL-3.0-or-later. See LICENSE.
