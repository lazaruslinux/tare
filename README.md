# tare

tare is a self-hosted food journal and health tracker for a small group of people sharing one instance. Its food database starts completely empty. Every food in it is one that somebody on the instance entered, and those entries are shared, so the database is worth more the longer the instance has been running and the less it resembles a generic product catalogue.

The only lookup that leaves the server is by barcode. Scanning a code that nobody has entered yet asks an online source for that product, and what comes back waits for an administrator to approve it before it joins the shared database. Nothing enters the database without a person deciding it should.

Beside the journal, tare records weight, exercise, and the step and workout data a phone sends in, and shows a read-only feed of what other people on the instance have logged. Accounts are created by invitation, so an instance stays the group it was set up for.

tare is built with Claude Code.

## Status

Early development. What runs today: invite-only accounts, private custom foods with unit and density conversion, the food journal, and the shared database with barcode scanning, browsing, suggested edits and label photos, and an approval queue that decides all three. Administrators also mint invite links and read the member list from the app. Health sync and the feed are not built yet.

## Running it

```
cp .env.example .env
```

Edit `.env` and replace the placeholders, at minimum `POSTGRES_PASSWORD` and `SECRET_KEY`. The api refuses to start while either is still the example value, and Postgres only reads its password the first time it creates the data directory, so set it before the first start.

```
docker compose up -d --build
```

The api listens on `127.0.0.1:8200` and the web front end on `127.0.0.1:8210`. The development override file also publishes Postgres on `127.0.0.1:55434`; delete or rename that file on a deployment. Nothing is published beyond loopback, so reaching an instance from elsewhere means putting a reverse proxy in front of it.

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

## License

AGPL-3.0-or-later. See LICENSE.
