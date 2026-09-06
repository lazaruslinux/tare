# Deploying an instance

One instance, one group of people, one machine. Everything runs in Docker and
listens on loopback, and a reverse proxy you already run puts it on the
internet with a certificate. This walks through it in order.

## What you need

- Docker with the Compose plugin. Nothing else is installed on the host.
- A domain name pointing at the machine, `tare.example.com` throughout this
  guide. Substitute your own.
- A reverse proxy that terminates TLS and sends `X-Forwarded-For`. That header
  is the only thing Tare has to tell one caller from another, and the rate
  limiters read it; a proxy that does not send it counts everybody's attempts
  into one bucket. Nothing else is read off a header: the session cookie's
  Secure flag comes from `COOKIE_SECURE` and the links Tare mails are built
  from `SITE_URL`, both set below.
- About a gigabyte of disk to start with. Photos are what grows.

## Configure

```
cp .env.example .env
```

Then open `.env` and go down it. In the file's order:

| Key | What to put |
|---|---|
| `POSTGRES_PASSWORD` | A long random password. Postgres only reads it when it first creates its data directory, so set it before the first start. |
| `SECRET_KEY` | The output of `openssl rand -hex 32`. It is checked at start, so an instance is never run on the example value. Sessions and mail links are random tokens rather than signed ones, so changing it later signs nobody out. |
| `TARE_TZ` | The zone the instance counts days in. One of the seven US zones the file lists. |
| `COOKIE_SECURE` | `true` once the instance is served over https, which is every real deployment. A browser drops a Secure cookie sent over plain http, which reads as sign-in silently failing. |
| `SITE_URL` | Where the instance answers, no trailing slash: `https://tare.example.com`. Only used to build the links that go out by mail; an instance that sends none can leave it empty. |
| `TRUSTED_PROXY_HOPS` | How many proxies of your own stand in front of the web container. One TLS proxy, which is the shape below, is `1`, and that is the default. Reaching the web container with nothing in front of it is `0`. Setting it higher than the number really there lets a caller pick their own rate-limit bucket. |
| `TARE_UPLOADS` | Whether members may hand the instance a health export as a file. `true` unless you want that address to stop existing. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional, and all five together or none. An email address is asked for at sign-up either way. With them the instance mails a verification link and keeps the new member on a verify screen until it is opened; without them there is nowhere to send one, so accounts are verified on the spot and the sign-in screen stops offering a password reset. |
| `SMTP_STARTTLS` | `true`. The one reason to turn it off is a local mail catcher while developing, which has no certificate to offer. |

`POSTGRES_PASSWORD` and `SECRET_KEY` must change. The api refuses to start
while either is still the example value, and says which one. It refuses the
same way when `SITE_URL` begins with `https://` while `COOKIE_SECURE` is false,
because that pair hands out a session cookie the browser will also send over
plain http.

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

Nothing in the app makes anybody an administrator, so if that account is lost
the role is handed to an existing one from the same shell:

```
docker compose exec api python manage.py grant-admin --username someone
```

Then mint a link for everybody else. Each code is good for one account:

```
docker compose exec api python manage.py create-invite
```

That prints the code and the path it lives at; the whole link is your address
followed by that path. `--days 7` gives it an expiry.

An instance that sends mail keeps a new member on the verify screen until they
open the link. When one never arrives and resending does not help, the address
can be marked verified by hand:

```
docker compose exec api python manage.py verify-email --username someone
```

Every food photo is stored with a small square copy beside it, which is what a
list of rows draws. Pictures stored before that get theirs from one command,
run once after an upgrade and safe to run again:

```
docker compose exec api python manage.py make-thumbnails
```

## Reviewers

There are two roles. An administrator runs the instance: invites, accounts,
uploads, the feedback log, the review log, and deleting a food from the shared
database. A reviewer does one job, the queue: they read what has been
submitted, approve, turn down or correct it, change the pictures on it, and
correct a food that is already shared. Nothing else about the instance is
theirs, and there is no path in the app that makes anybody an administrator.

Roles are handed out from More, Member accounts: a Reviewer switch on each
member's row. A member whose submissions have mostly been taken can apply for
the role from their own More list, which puts a note on their row; an
administrator still decides. Every decision either role makes is written to the
review log, which administrators read under More.

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

### Behind Cloudflare

Cloudflare is not another hop to count. It sends the real caller in its own
`CF-Connecting-IP` header rather than adding to `X-Forwarded-For`, so have your
proxy write that into the header Tare reads and leave `TRUSTED_PROXY_HOPS=1`.
In Caddy that is one line:

```
tare.example.com {
    reverse_proxy 127.0.0.1:8210 {
        header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
    }
}
```

Turn off anything that rewrites the page on the way through: Rocket Loader,
Mirage and email obfuscation each add a script this instance did not send, and
the Content-Security-Policy it does send allows no inline script at all, so the
browser refuses them and the app stops loading.

Leave the address a phone syncs to out of any challenge or bot rule. An
automation posting a health export cannot answer a captcha or run the
JavaScript one needs, so a challenge in front of it reads on the phone as
syncing having quietly stopped.

## Optional: map tiles

A workout's route is drawn as a line, and that is all it is: no tile server, no
library, no request to anybody outside this instance. If you want that line
over an actual map, you can give the instance one, and the Route card shows the
map instead, with a full-screen view when it is tapped. The map is still served
by this instance alone.

Leaving this out costs nothing. With the folder empty the app asks the server
for a single byte of the archive, is told there is none, and draws the line;
the renderer is a chunk of its own and is never fetched at all.

Make the folder next to `docker-compose.yml`, before the first
`docker compose up`, so Docker does not create it owned by root:

```
mkdir tiles
```

Cut the area you want out of a Protomaps daily build with their `pmtiles`
tool. The whole planet is around a hundred gigabytes; one city and the country
around it is a few hundred megabytes.

```
pmtiles extract https://build.protomaps.com/<date>.pmtiles tiles/basemap.pmtiles --bbox=W,S,E,N
```

The lettering and the symbols are separate, and come from the releases of the
`protomaps/basemaps-assets` repository: the font glyphs, and the two sprite
sheets named `dark` and `light`. Unpack them so the folder reads:

```
tiles/
  basemap.pmtiles
  basemap/
    fonts/Noto Sans Regular/0-255.pbf
    fonts/Noto Sans Medium/0-255.pbf
    fonts/Noto Sans Italic/0-255.pbf
    ...
    sprites/dark.json
    sprites/dark.png
    sprites/dark@2x.json
    sprites/dark@2x.png
    sprites/light.json
    sprites/light.png
    sprites/light@2x.json
    sprites/light@2x.png
```

Then pick it up:

```
docker compose up -d web
```

No rebuild. The folder is mounted into the web container read-only, so
recutting the archive and restarting that one container is the whole of it.

Coverage is whatever you cut. A workout recorded outside the box you asked for
draws its route over empty ground, so cut the area your members are actually
in, and cut it again if that changes.

The tiles are OpenStreetMap data. The credit for it sits folded into the corner
of the map and stays there.

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
  begins "Tare cannot start until this is fixed" names what in `.env` is wrong:
  a key still on its example value, a zone Tare does not offer, or
  `COOKIE_SECURE` left false on an https instance. Nothing else in the stack
  stops it starting.
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
