# Deploying an instance

One instance, one group of people, one machine. Everything runs in Docker and
listens on loopback, and a reverse proxy you already run puts it on the
internet with a certificate. This walks through it in order.

## What you need

- Docker with the Compose plugin. Nothing else is installed on the host.
- A domain name pointing at the machine, `tare.example.com` throughout this
  guide. Substitute your own.
- A reverse proxy that terminates TLS and sends `X-Forwarded-Proto: https`.
  Tare marks its session cookie Secure and builds the links it mails from that
  header, so a proxy that does not send it leaves sign-in failing and the
  links pointing at `http`.
- About a gigabyte of disk to start with. Photos are what grows.

## Configure

```
cp .env.example .env
```

Then open `.env` and go down it. In the file's order:

| Key | What to put |
|---|---|
| `POSTGRES_PASSWORD` | A long random password. Postgres only reads it when it first creates its data directory, so set it before the first start. |
| `SECRET_KEY` | The output of `openssl rand -hex 32`. It signs sessions and mail tokens; changing it later signs everybody out. |
| `TARE_TZ` | The zone the instance counts days in. One of the seven US zones the file lists. |
| `COOKIE_SECURE` | `true` once the instance is served over https, which is every real deployment. A browser drops a Secure cookie sent over plain http, which reads as sign-in silently failing. |
| `SITE_URL` | Where the instance answers, no trailing slash: `https://tare.example.com`. Only used to build the links that go out by mail; an instance that sends none can leave it empty. |
| `TRUSTED_PROXY_HOPS` | How many proxies of your own stand in front of the web container. One TLS proxy, which is the shape below, is `1`, and that is the default. Reaching the web container with nothing in front of it is `0`. Setting it higher than the number really there lets a caller pick their own rate-limit bucket. |
| `TARE_UPLOADS` | Whether members may hand the instance a health export as a file. `true` unless you want that address to stop existing. |
| `USDA_API_KEY` | Optional. A free key from api.data.gov adds USDA's Branded set to barcode lookups. Without one, lookups use Open Food Facts alone. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional, and all five together or none. With them the instance can mail invites, verification and password resets; without them it sends nothing and the sign-in screen stops offering a reset link. |

`POSTGRES_PASSWORD` and `SECRET_KEY` must change. The api refuses to start
while either is still the example value, and says which one.

## Start

The development override publishes Postgres on the host, which a deployment
has no use for. Delete or rename it first:

```
rm docker-compose.override.yml
docker compose up -d --build
```

The api brings the database schema up to date every time it starts, so there
is no migration step to remember. The api listens on `127.0.0.1:8200` and the
web front end on `127.0.0.1:8210`. Nothing is published beyond loopback.

There is deliberately no way to make the first account from a browser. Make it
from a shell, which prompts for the password rather than taking it as an
argument:

```
docker compose exec api python manage.py create-admin --username you --birthdate 1990-01-15
```

Then mint a link for everybody else. Each code is good for one account:

```
docker compose exec api python manage.py create-invite
```

That prints the code and the path it lives at; the whole link is your address
followed by that path. `--days 7` gives it an expiry.

On an instance that sends no mail, an address is marked verified by hand:

```
docker compose exec api python manage.py verify-email --username someone
```

## Put a proxy in front

Everything the browser asks for goes to the web container on
`127.0.0.1:8210`, `/api` included: it forwards that on itself, so there is
only ever one origin. Two examples.

Caddy:

```
tare.example.com {
    reverse_proxy 127.0.0.1:8210
}
```

Caddy gets a certificate on its own and sends the forwarded headers without
being told to.

nginx:

```
server {
    listen 443 ssl;
    server_name tare.example.com;

    ssl_certificate     /etc/letsencrypt/live/tare.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tare.example.com/privkey.pem;

    # Photos and health exports are the large bodies. The web container caps
    # each address itself; this only has to be no smaller.
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:8210;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Either way, that is one proxy of your own in front of the web container, so
`TRUSTED_PROXY_HOPS=1`, which is what `.env.example` already has. The count is
what rate limiting reads a caller's address through: too high and everybody
shares one bucket under your proxy's address.

## Update

```
git pull
docker compose up -d --build
```

Migrations run as the api starts. The front end is a service worker: a member
with the app open keeps the build they have until they close it, and the new
one is downloaded in the background and applied the next time they open it.
Nothing asks them to reload.

## Back up

Two things are worth keeping: the database, and `/data` inside the api
container, which holds the photos and the feedback file.

```
docker compose exec -T db pg_dump -U tare -d tare --clean --if-exists > tare-db-$(date +%F).sql
docker compose cp api:/data ./tare-data-$(date +%F)
```

Both run against a live instance. Keep them together: a database that names
photos the files no longer beside it is half a backup.

To restore, put the database back before the files, and take the app down
while you do it:

```
docker compose stop web api
cat tare-db-2026-01-31.sql | docker compose exec -T db psql -U tare -d tare
docker compose cp ./tare-data-2026-01-31/. api:/data
docker compose start api web
docker compose exec --user root api chown -R tare:tare /data
```

The dump drops what it is replacing on the way in, so restoring over a
database that already has rows is the same operation as restoring into an
empty one. The last line is the one that is easy to forget: files copied back
in arrive owned by root, and the api runs as `tare` and cannot write beside
them.

## If something is wrong

- The api will not start. Read `docker compose logs api`. A refusal that
  begins "Tare cannot start until this is fixed" names the key in `.env` that
  is still an example value or is not a zone Tare offers; nothing else in the
  stack stops it starting.
- Every screen says the server is not answering. That sentence is the web
  container's, said when the api does not answer it: the api is down or still
  starting. `docker compose ps` says which and `docker compose logs api` says
  why.
- Signing in appears to do nothing. `COOKIE_SECURE=true` on an instance being
  reached over plain http, so the browser is dropping the session cookie. Put
  TLS in front, or set it to `false` while testing locally.
- The rate limits refuse everybody at once. `TRUSTED_PROXY_HOPS` is higher
  than the number of proxies really in front, so no address is read out of the
  forwarded header and everyone shares one bucket under the proxy's own
  address. Lower it by one.
