"""The two RFCs, held to their own numbers.

The encryption is checked against the known answer published in RFC 8291
Appendix A rather than against itself: an implementation that agrees with its
own mistake would pass a round trip happily and be refused by every browser.
"""

import base64
import datetime as dt
import json

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app import webpush
from app.config import settings

# RFC 8291 Appendix A, copied from the published text. Every value is base64url
# without padding.
PLAINTEXT = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"
AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
SALT = "DGv6ra1nlYgDCS1FRnbzlw"
AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg"
ECDH_SECRET = "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"
IKM = "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"
CEK = "oIhVW04MRdy2XN9CiKLxTg"
NONCE = "4h_95klXJ5E_qnoN"
BODY = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmY"
    "WAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexS"
    "gSxsj_Qulcy4a-fN"
)

# A fabricated subscription in the shape a browser hands over.
ENDPOINT = "https://push.example.net/push/abcdef"


def scalar_key(value: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(webpush.b64url_decode(value), "big"), ec.SECP256R1())


@pytest.fixture()
def with_keys(monkeypatch):
    """An instance that has been given a key pair and a contact address."""
    monkeypatch.setattr(settings, "vapid_private_key", AS_PRIVATE)
    monkeypatch.setattr(settings, "vapid_subject", "mailto:admin@example.com")


def test_base64url_goes_both_ways_without_padding():
    assert webpush.b64url_encode(b"\x00\x01\x02") == "AAEC"
    assert webpush.b64url_decode("AAEC") == b"\x00\x01\x02"
    with pytest.raises(ValueError):
        webpush.b64url_decode("not base64 $$$")


def test_a_private_key_has_to_be_thirty_two_bytes():
    assert len(webpush.checked_private_key(AS_PRIVATE)) == 32
    with pytest.raises(ValueError):
        webpush.checked_private_key(webpush.b64url_encode(b"short"))


def test_the_intermediate_values_match_the_rfc():
    """Each derivation on its own, so a failure says which one moved."""
    as_private = scalar_key(AS_PRIVATE)
    ua_public = webpush.b64url_decode(UA_PUBLIC)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    ecdh_secret = as_private.exchange(ec.ECDH(), ua_key)
    assert webpush.b64url_encode(ecdh_secret) == ECDH_SECRET

    as_public = webpush.b64url_decode(AS_PUBLIC)
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=webpush.b64url_decode(AUTH_SECRET),
        info=b"WebPush: info\x00" + ua_public + as_public,
    ).derive(ecdh_secret)
    assert webpush.b64url_encode(ikm) == IKM

    salt = webpush.b64url_decode(SALT)
    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)
    assert webpush.b64url_encode(cek) == CEK
    assert webpush.b64url_encode(nonce) == NONCE


def test_the_encrypted_body_is_the_rfcs_own_answer():
    body = webpush.encrypt(
        webpush.b64url_decode(PLAINTEXT),
        webpush.b64url_decode(UA_PUBLIC),
        webpush.b64url_decode(AUTH_SECRET),
        as_private=scalar_key(AS_PRIVATE),
        salt=webpush.b64url_decode(SALT),
    )
    assert webpush.b64url_encode(body) == BODY


def test_the_header_is_laid_out_the_way_the_content_encoding_says():
    body = webpush.encrypt(
        webpush.b64url_decode(PLAINTEXT),
        webpush.b64url_decode(UA_PUBLIC),
        webpush.b64url_decode(AUTH_SECRET),
        as_private=scalar_key(AS_PRIVATE),
        salt=webpush.b64url_decode(SALT),
    )
    assert body[:16] == webpush.b64url_decode(SALT)
    assert int.from_bytes(body[16:20], "big") == webpush.RECORD_SIZE
    assert body[20] == 65
    assert webpush.b64url_encode(body[21:86]) == AS_PUBLIC


def test_the_public_key_is_derived_from_the_scalar():
    assert webpush.public_key_of(webpush.b64url_decode(AS_PRIVATE)) == AS_PUBLIC


def test_a_fresh_key_pair_round_trips_to_the_receiver():
    """The other side of the vector: a message nobody has the answer to."""
    ua_private = ec.generate_private_key(ec.SECP256R1())
    ua_public = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    auth_secret = b"sixteen bytes123"
    body = webpush.encrypt(b'{"title":"Hello"}', ua_public, auth_secret)

    salt, rs, idlen = body[:16], body[16:20], body[20]
    as_public = body[21 : 21 + idlen]
    assert int.from_bytes(rs, "big") == webpush.RECORD_SIZE
    ecdh_secret = ua_private.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    )
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=auth_secret,
        info=b"WebPush: info\x00" + ua_public + as_public,
    ).derive(ecdh_secret)
    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)
    record = AESGCM(cek).decrypt(nonce, body[86:], None)
    assert record == b'{"title":"Hello"}\x02'


def test_the_receiver_of_the_rfcs_own_message_reads_the_watermelon():
    """The vector's own private key, proving the whole record decrypts."""
    ua_private = scalar_key(UA_PRIVATE)
    body = webpush.b64url_decode(BODY)
    as_public = body[21:86]
    ecdh_secret = ua_private.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    )
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=webpush.b64url_decode(AUTH_SECRET),
        info=b"WebPush: info\x00" + webpush.b64url_decode(UA_PUBLIC) + as_public,
    ).derive(ecdh_secret)
    salt = body[:16]
    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)
    assert AESGCM(cek).decrypt(nonce, body[86:], None) == (
        b"When I grow up, I want to be a watermelon\x02"
    )


def part(token: str, index: int) -> dict:
    piece = token.split(".")[index]
    return json.loads(base64.urlsafe_b64decode(piece + "=" * (-len(piece) % 4)))


def test_the_signature_says_who_is_sending_and_for_how_long(with_keys):
    now = dt.datetime(2026, 9, 15, 12, 0, tzinfo=dt.timezone.utc)
    token = webpush.vapid_token("https://push.example.net", now)
    assert part(token, 0) == {"typ": "JWT", "alg": "ES256"}
    claims = part(token, 1)
    assert claims["aud"] == "https://push.example.net"
    assert claims["sub"] == "mailto:admin@example.com"
    assert 0 < claims["exp"] - int(now.timestamp()) <= 24 * 3600


def test_the_signature_verifies_against_the_public_key(with_keys):
    token = webpush.vapid_token("https://push.example.net")
    signing_input, _, signature = token.rpartition(".")
    raw = webpush.b64url_decode(signature)
    der = encode_dss_signature(
        int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    )
    scalar_key(AS_PRIVATE).public_key().verify(
        der, signing_input.encode("ascii"), ec.ECDSA(hashes.SHA256())
    )


def test_the_authorization_header_carries_the_token_and_the_key(with_keys):
    headers = webpush.vapid_headers(f"{ENDPOINT}?token=1")
    value = headers["Authorization"]
    assert value.startswith("vapid t=")
    token, _, key = value.partition(", k=")
    assert key == webpush.public_key()
    assert len(key) == 87
    # The audience is the service's origin and never the path, which would
    # tell the service which subscription this key was minted against.
    assert part(token.removeprefix("vapid t="), 1)["aud"] == "https://push.example.net"


def fake(handler, monkeypatch):
    monkeypatch.setattr(
        webpush, "session", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )


def push(**extra):
    return webpush.send(ENDPOINT, UA_PUBLIC, AUTH_SECRET, {"title": "Hi"}, **{"ttl": 60, **extra})


def test_a_send_carries_the_content_encoding_and_the_headers(with_keys, monkeypatch):
    seen: dict[str, object] = {}

    def handler(request):
        seen["headers"] = dict(request.headers)
        seen["body"] = request.content
        return httpx.Response(201)

    fake(handler, monkeypatch)
    assert push(topic="morning") is webpush.Outcome.SENT
    headers = seen["headers"]
    assert headers["content-encoding"] == "aes128gcm"
    assert headers["content-type"] == "application/octet-stream"
    assert headers["ttl"] == "60"
    assert headers["urgency"] == "normal"
    assert headers["topic"] == "morning"
    assert headers["authorization"].startswith("vapid t=")
    # The body is the sealed record, not the JSON.
    assert b"title" not in seen["body"]


def test_a_send_without_a_topic_sends_no_topic_header(with_keys, monkeypatch):
    seen: dict[str, object] = {}

    def handler(request):
        seen["headers"] = dict(request.headers)
        return httpx.Response(200)

    fake(handler, monkeypatch)
    assert push() is webpush.Outcome.SENT
    assert "topic" not in seen["headers"]


@pytest.mark.parametrize("code", [404, 410])
def test_a_subscription_the_service_has_dropped_comes_back_gone(with_keys, monkeypatch, code):
    fake(lambda request: httpx.Response(code), monkeypatch)
    assert push() is webpush.Outcome.GONE


@pytest.mark.parametrize("code", [413, 429, 500])
def test_everything_else_is_a_failure_that_is_logged(with_keys, monkeypatch, code, caplog):
    fake(lambda request: httpx.Response(code, headers={"Retry-After": "120"}), monkeypatch)
    with caplog.at_level("WARNING", logger="tare.push"):
        assert push() is webpush.Outcome.FAILED
    assert caplog.records


def test_a_network_that_is_not_answering_never_raises(with_keys, monkeypatch, caplog):
    def handler(request):
        raise httpx.ConnectError("no route", request=request)

    fake(handler, monkeypatch)
    with caplog.at_level("WARNING", logger="tare.push"):
        assert push() is webpush.Outcome.FAILED
    assert caplog.records


def test_keys_that_do_not_decode_are_a_device_that_is_gone(with_keys, monkeypatch):
    fake(lambda request: httpx.Response(201), monkeypatch)
    assert (
        webpush.send(ENDPOINT, "not-a-key", AUTH_SECRET, {"title": "Hi"}, ttl=60)
        is webpush.Outcome.GONE
    )


def test_a_payload_too_large_to_seal_is_refused_rather_than_sent(with_keys, monkeypatch, caplog):
    def handler(request):  # pragma: no cover - reaching this is the failure
        raise AssertionError("an oversized payload should never be posted")

    fake(handler, monkeypatch)
    with caplog.at_level("WARNING", logger="tare.push"):
        outcome = webpush.send(
            ENDPOINT,
            UA_PUBLIC,
            AUTH_SECRET,
            {"title": "x" * (webpush.MAX_PLAINTEXT + 100)},
            ttl=60,
        )
    assert outcome is webpush.Outcome.FAILED


def test_an_instance_without_both_settings_is_not_configured(monkeypatch):
    assert webpush.configured() is False
    monkeypatch.setattr(settings, "vapid_private_key", AS_PRIVATE)
    assert webpush.configured() is False
    monkeypatch.setattr(settings, "vapid_subject", "mailto:admin@example.com")
    assert webpush.configured() is True
