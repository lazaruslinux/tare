# Tare

Tare is a food journal and health tracker with a community-built food database. The database starts completely empty. Every food in it was entered by a member and checked by a person before it was published, so the database grows more useful the longer Tare has been running and the less it resembles a generic product catalogue.

The only lookup that leaves the server is by barcode. Scanning a code that nobody has entered yet asks an online source for that product, and what comes back waits for a reviewer to approve it before it joins the shared database. Nothing enters the database without a person deciding it should.

Beside the journal, Tare records weight, exercise, and the step and workout data a phone sends in, and shows a read-only feed of what other members have chosen to share. Accounts are created by invitation.

Tare is open source under the AGPL and can be self-hosted; see Running it below.

This project was built with Claude Code, an agentic coding platform, through hundreds of human iterations and thousands of prompts.

## Status

Early development, and most of it is running. Today: invite-only accounts, private custom foods, the journal with meals, recipes, auto-logged daily foods and day completion, the shared database with barcode scanning, browsing by aisle, reported issues, label photos and the approval queue that decides all of it, calorie and macro targets worked out from a weight goal, weigh-ins and body measurements, health sync from a phone including workouts and routes, member profiles, and a community feed with a sharing switch over every part of it.

## Running it

```
cp .env.example .env
```

Edit `.env` and replace the placeholders, at minimum `POSTGRES_PASSWORD` and `SECRET_KEY`. The api refuses to start while either is still the example value, and Postgres only reads its password the first time it creates the data directory, so set it before the first start.

```
docker compose up -d --build
```

The api listens on `127.0.0.1:8200` and the web front end on `127.0.0.1:8210`. The development override file also publishes Postgres on `127.0.0.1:55434`; delete or rename that file on a deployment. Nothing is published beyond loopback, so reaching an instance from elsewhere means putting a reverse proxy in front of it.

For a real deployment, with the proxy, the first account, backups and what each setting does, see [docs/DEPLOY.md](docs/DEPLOY.md).

To work on the front end against a running api:

```
cd frontend && npm install && npm run dev
```

That serves on port 5190 and forwards `/api` to `127.0.0.1:8200`.

To run the backend checks:

```
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install --require-hashes -r requirements.txt
pip install -r requirements-dev.txt
ruff check . && mypy && pytest -q
```

## Data sources

The barcode scanner first searches the Tare database for existing items. If it doesn't exist, it searches Open Food Facts, whose data is available under the Open Database License (ODbL). Once an item is approved, it's stored on Tare's server and doesn't have to reach out to the internet.

Calorie and nutrient targets follow the Dietary Guidelines for Americans and the American Heart Association. Tare uses math to make estimates, and does not provide medical advice. Talk to your doctor/clinician before changing how you eat, especially if pregnant, breastfeeding, under care for a medical condition, or have a history of eating disorders.

## License

AGPL-3.0-or-later. See LICENSE.
