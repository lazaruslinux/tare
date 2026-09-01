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
    # clock, and this is the zone the app renders in.
    tz: str = Field(default="UTC", validation_alias="TARE_TZ")

    usda_api_key: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    media_dir: str = "/data/media"

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

    if problems:
        raise RuntimeError("tare cannot start until this is fixed:\n- " + "\n- ".join(problems))
