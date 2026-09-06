import pytest

from app.config import Settings, check_deploy_config


def test_placeholder_secret_is_refused_with_a_fix():
    unconfigured = Settings(
        database_url="sqlite://",
        secret_key="replace-with-openssl-rand-hex-32",
    )
    with pytest.raises(RuntimeError) as raised:
        check_deploy_config(unconfigured)
    message = str(raised.value)
    assert "SECRET_KEY" in message
    assert "openssl rand -hex 32" in message


def test_missing_database_password_is_refused():
    # database_url is cleared explicitly: the test environment sets one, and
    # the guard skips the password when a whole URL is supplied.
    unconfigured = Settings(database_url="", secret_key="a-real-secret", postgres_password="")
    with pytest.raises(RuntimeError) as raised:
        check_deploy_config(unconfigured)
    assert "POSTGRES_PASSWORD" in str(raised.value)


def test_configured_settings_pass():
    check_deploy_config(Settings(database_url="sqlite://", secret_key="a-real-secret"))


def test_a_timezone_tare_does_not_offer_is_refused():
    wrong = Settings(database_url="sqlite://", secret_key="a-real-secret", TARE_TZ="Europe/Paris")
    with pytest.raises(RuntimeError) as raised:
        check_deploy_config(wrong)
    assert "TARE_TZ" in str(raised.value)


def test_an_https_instance_with_a_plain_cookie_is_refused():
    exposed = Settings(
        database_url="sqlite://",
        secret_key="a-real-secret",
        site_url="https://tare.example.com",
        cookie_secure=False,
    )
    with pytest.raises(RuntimeError) as raised:
        check_deploy_config(exposed)
    message = str(raised.value)
    assert "COOKIE_SECURE" in message
    assert "SITE_URL" in message


def test_an_https_instance_with_a_secure_cookie_passes():
    check_deploy_config(
        Settings(
            database_url="sqlite://",
            secret_key="a-real-secret",
            site_url="https://tare.example.com",
            cookie_secure=True,
        )
    )


def test_a_plain_http_instance_may_leave_the_cookie_off():
    # The shape somebody testing locally has, and the reason the flag is off by
    # default: a Secure cookie never reaches http://127.0.0.1 at all.
    check_deploy_config(
        Settings(
            database_url="sqlite://",
            secret_key="a-real-secret",
            site_url="http://127.0.0.1:8210",
            cookie_secure=False,
        )
    )
