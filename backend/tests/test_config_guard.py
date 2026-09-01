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
