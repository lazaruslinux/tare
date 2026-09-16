"""Web Push over the browser vendors' services, with the payload sealed.

RFC 8291 for the encryption and RFC 8292 for the signature, written out here
rather than pulled in as a library: the whole protocol is two key derivations,
one AES-GCM record and a small JWT, and the libraries that do it carry a second
HTTP client and a second crypto stack behind them. The push service moves a
body it cannot read, which is the point of doing it this way at all.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import logging
import os
from enum import Enum
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

log = logging.getLogger("tare.push")

# What an instance without keys says, in the one place both the API and the
# screen read it from.
NOT_SET_UP = "Notifications are not set up on this instance."

# One record per message, at the size the content encoding header declares.
RECORD_SIZE = 4096
# 16 salt, 4 record size, 1 key length, 65 key.
HEADER_LEN = 86
# What is left for the JSON once the header, the AES-GCM tag and the padding
# delimiter have taken their share. Push services refuse a body over 4096.
MAX_PLAINTEXT = RECORD_SIZE - HEADER_LEN - 16 - 1

# How long a signature is good for. The RFC allows a day; half of one is long
# enough for a tick to finish and short enough that a captured token is stale.
TOKEN_HOURS = 12

# A send waits this long and no longer. One member with a phone that is not
# answering must not hold up the rest of a tick.
TIMEOUT = 10


class Outcome(str, Enum):
    """What came of one send, in the three answers the caller acts on."""

    SENT = "sent"
    GONE = "gone"
    FAILED = "failed"


def b64url_encode(raw: bytes) -> str:
    """Base64url with the padding stripped, which is the form every value in
    these two RFCs is written in."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    """The other way, padding put back. Anything that is not base64url raises
    ValueError rather than coming back short."""
    padded = text + "=" * (-len(text) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as wrong:
        raise ValueError("not base64url") from wrong


def checked_private_key(raw: str) -> bytes:
    """The configured key as bytes, or ValueError saying which way it is wrong."""
    scalar = b64url_decode(raw)
    if len(scalar) != 32:
        raise ValueError("a P-256 private key is 32 bytes")
    return scalar


def configured() -> bool:
    """Whether this instance can send a notification at all.

    Both settings or neither, the way mail is read: a key with no contact
    address is a half-filled form, and the push services ask for the address.
    """
    return bool(settings.vapid_private_key and settings.vapid_subject)


def private_key() -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(
        int.from_bytes(checked_private_key(settings.vapid_private_key), "big"),
        ec.SECP256R1(),
    )


def public_key_of(scalar: bytes) -> str:
    """The public half of a raw scalar, uncompressed, as the browser wants it."""
    key = ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1())
    return b64url_encode(
        key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )


def public_key() -> str:
    """This instance's application server key, which the browser subscribes with."""
    return public_key_of(checked_private_key(settings.vapid_private_key))


def encrypt(
    plaintext: bytes,
    ua_public: bytes,
    auth_secret: bytes,
    *,
    as_private: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """One aes128gcm record, header and all, per RFC 8291 section 3.

    The two keyword arguments exist for the RFC's own known-answer vector. A
    real send generates both, because reusing either against one subscription
    would hand the same keystream to two messages.
    """
    if as_private is None:
        as_private = ec.generate_private_key(ec.SECP256R1())
    if salt is None:
        salt = os.urandom(16)
    as_public = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    ecdh_secret = as_private.exchange(ec.ECDH(), ua_key)

    # Section 3.3: the shared secret is combined with the subscription's own
    # authentication secret, so a push service holding the public keys still
    # cannot derive the content key.
    key_info = b"WebPush: info\x00" + ua_public + as_public
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=key_info).derive(
        ecdh_secret
    )
    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(),
        length=12,
        salt=salt,
        info=b"Content-Encoding: nonce\x00",
    ).derive(ikm)

    # RFC 8188 section 2: 0x02 marks the last record, and there is only one.
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + ciphertext


def vapid_token(origin: str, now: dt.datetime | None = None) -> str:
    """An ES256 JWT saying who is sending, for one push service's origin."""
    moment = now or dt.datetime.now(dt.timezone.utc)
    header = b64url_encode(b'{"typ":"JWT","alg":"ES256"}')
    claims = b64url_encode(
        json.dumps(
            {
                "aud": origin,
                "exp": int(moment.timestamp()) + TOKEN_HOURS * 3600,
                "sub": settings.vapid_subject,
            },
            separators=(",", ":"),
        ).encode("ascii")
    )
    signing_input = f"{header}.{claims}".encode("ascii")
    der = private_key().sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    # JOSE wants the pair raw and fixed width, not the DER the library returns.
    signature = b64url_encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"{header}.{claims}.{signature}"


def vapid_headers(endpoint: str) -> dict[str, str]:
    """The one authorization header RFC 8292 asks for, audience and all."""
    parts = urlsplit(endpoint)
    token = vapid_token(f"{parts.scheme}://{parts.netloc}")
    return {"Authorization": f"vapid t={token}, k={public_key()}"}


def session() -> httpx.Client:
    """The client every send goes out on. The one place a test swaps in a
    transport, so nothing below it reaches a network by accident."""
    return httpx.Client(timeout=TIMEOUT)


def send(
    endpoint: str,
    p256dh: str,
    auth: str,
    payload: dict[str, Any],
    *,
    ttl: int,
    topic: str | None = None,
    urgency: str = "normal",
    client: httpx.Client | None = None,
) -> Outcome:
    """Post one notification, and never raise.

    Every way this can fail is somebody else's server or a subscription that
    has expired, and neither is a reason for a request or a scheduler tick to
    come apart. The answer says what the caller should do with the row.
    """
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_PLAINTEXT:
        log.warning("push payload too large to encrypt: %d bytes", len(body))
        return Outcome.FAILED
    try:
        sealed = encrypt(body, b64url_decode(p256dh), b64url_decode(auth))
        headers = {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            "TTL": str(ttl),
            "Urgency": urgency,
            **vapid_headers(endpoint),
        }
    except ValueError as wrong:
        # Keys that no longer decode belong to a row that can never be sent to.
        log.warning("push subscription has unusable keys: %s", wrong)
        return Outcome.GONE
    if topic is not None:
        headers["Topic"] = topic

    owned = client is None
    out = client or session()
    try:
        response = out.post(endpoint, content=sealed, headers=headers)
    except httpx.HTTPError as failure:
        log.warning("push send failed: %s", failure)
        return Outcome.FAILED
    finally:
        if owned:
            out.close()

    if 200 <= response.status_code < 300:
        return Outcome.SENT
    if response.status_code in (404, 410):
        return Outcome.GONE
    if response.status_code == 413:
        log.warning("push service refused the payload as too large")
        return Outcome.FAILED
    if response.status_code == 429:
        log.warning(
            "push service is rate limiting; retry after %s",
            response.headers.get("retry-after", "unstated"),
        )
        return Outcome.FAILED
    log.warning("push service answered %d", response.status_code)
    return Outcome.FAILED
