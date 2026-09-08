"""Settings, read once from the environment, and the guard that refuses a
half-configured install."""

from __future__ import annotations

from urllib.parse import quote

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

VERSION = "0.1.0"

# The literal values shipped in .env.example. An install still carrying one of
# them has not been configured at all, which is a different fault from a bad
# value and gets its own refusal.
PLACEHOLDERS = frozenset(
    {
        "replace-with-openssl-rand-hex-32",
        "replace-with-a-long-random-password",
    }
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # Either hand over a whole URL, or let the parts below build one. The whole
    # URL wins, which is what lets the tests point at SQLite.
    database_url: str = ""
    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "tare"
    postgres_user: str = "tare"
    postgres_password: str = ""

    secret_key: str = ""
    session_hours: int = 720

    # Whether the session cookie is marked Secure. Off by default because the
    # first thing anyone does is open http://127.0.0.1, and a Secure cookie is
    # dropped on the way there, which reads as sign-in silently failing. Any
    # install served over TLS turns this on.
    cookie_secure: bool = False

    # Where this instance answers, used to build the links that go out by mail.
    # Only mail needs it, so an install that sends none can leave it empty.
    site_url: str = ""

    # How many reverse proxies of your own stand in front of this. The stack
    # ships with one (the web container), and the rate limiter reads that many
    # entries in from the right of X-Forwarded-For; see throttle.client_address
    # for why the direction matters.
    trusted_proxy_hops: int = 1

    # Named TARE_TZ rather than TZ: containers already use TZ for the system
    # clock, and this is the zone the app renders in. One of the seven zones
    # tare offers, which is what the deploy check below holds it to.
    tz: str = Field(default="America/New_York", validation_alias="TARE_TZ")

    # Whether a member may hand this server a health export as a file. On by
    # default, because that is how somebody moves a year of history in. An
    # instance that would rather only ever be posted to by a phone turns it
    # off, and the address stops existing rather than starting to argue.
    uploads_enabled: bool = Field(default=True, validation_alias="TARE_UPLOADS")

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    # Whether the connection is upgraded to TLS before anything is sent. On,
    # because every real relay wants it. The one reason to turn it off is a
    # mail catcher on the same machine while developing.
    smtp_starttls: bool = True

    # A key for FoodData Central, which the vitamin backfill and the vitamin
    # picker read and nothing else does. Empty on an install that never fills
    # a food's vitamins from there, and those two tools then say so and stop.
    usda_api_key: str = ""

    media_dir: str = "/data/media"

    # Where members' feedback is appended. A file rather than a table: it is
    # prose an administrator reads start to finish, and nothing queries it.
    feedback_path: str = "/data/feedback.md"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        # Percent-encoded: a generated password containing @ or / would
        # otherwise end the userinfo early and point at the wrong host.
        return (
            f"postgresql+psycopg://{quote(self.postgres_user)}:"
            f"{quote(self.postgres_password)}@{self.postgres_host}:"
            f"{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()


def check_deploy_config(current: Settings | None = None) -> None:
    """Raise unless this install can be served safely.

    Called at application import and from the migration environment, so a
    misconfigured install fails before uvicorn binds a port rather than serving
    requests it should not.
    """
    s = settings if current is None else current
    problems: list[str] = []

    if not s.secret_key or s.secret_key in PLACEHOLDERS:
        problems.append(
            "SECRET_KEY is missing or still set to the example value. "
            "Put a fresh random value in your .env file, for example the "
            "output of: openssl rand -hex 32"
        )

    # Only worth checking when the URL is being assembled from parts; a whole
    # DATABASE_URL carries its own credentials.
    if not s.database_url and (not s.postgres_password or s.postgres_password in PLACEHOLDERS):
        problems.append(
            "POSTGRES_PASSWORD is missing or still set to the example value. "
            "Choose a password in your .env file, then recreate the database "
            "container so it is created with that password."
        )

    # An instance whose links say https is served over TLS, and a session
    # cookie without the Secure flag on such a site is one a browser will also
    # send over plain http.
    if s.site_url.startswith("https://") and not s.cookie_secure:
        problems.append(
            "COOKIE_SECURE must be true when SITE_URL is https. Without it the "
            "browser will send the session cookie over plain http as well, "
            "which is a session anybody on the network can take. Set "
            "COOKIE_SECURE=true in your .env file."
        )

    # Imported here rather than at the top: security reads settings, so the
    # module-level import would be a circle.
    from app.security import US_ZONES

    if s.tz not in US_ZONES:
        problems.append(
            f"TARE_TZ is set to {s.tz!r}, which is not a zone Tare offers. "
            "Use one of: " + ", ".join(US_ZONES)
        )

    if problems:
        raise RuntimeError("Tare cannot start until this is fixed:\n- " + "\n- ".join(problems))
