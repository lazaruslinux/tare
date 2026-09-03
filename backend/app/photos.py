"""Turning an uploaded picture into a file this server is willing to serve.

The bargain: the bytes that arrive are size-capped, decoded to prove they are
an image at all, and then thrown away. What lands on disk is a webp this process
built, scaled to fit, carrying no metadata, under a name this process chose. A
filename, an extension and a content type are all claims made by whoever is
uploading, and none of them is trusted with anything.
"""

from __future__ import annotations

import io
import logging
import os
import secrets
import tempfile

from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

log = logging.getLogger("tare.photos")

# What a phone camera produces, with room to spare. The reverse proxy and the
# application both cap the request a little above this, so an oversized upload
# is refused by this module's own sentence rather than by a truncated body.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Past this Pillow only warns. A small file can declare an enormous canvas, and
# decoding it is how a single request eats the machine's memory.
MAX_PIXELS = 25_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

# How large a stored picture is allowed to be, by what it is for. A label has
# small print somebody has to read, so it keeps its detail; a front is a pack
# on a shelf at thumbnail size and does not. Beyond this is bytes nobody looks
# at.
MAX_EDGES = {"front": 1200, "label": 1600}
QUALITY = 78

SUFFIX = ".webp"
MEDIA_TYPE = "image/webp"


class RejectedImage(Exception):
    """The upload is not an image this server is willing to store."""


def directory() -> str:
    # Read through settings at call time rather than at import, so a test can
    # point the whole thing at a temporary directory.
    return os.path.join(settings.media_dir, "food-photos")


def path_for(name: str) -> str:
    """Where one stored photo lives. The name came from store(), never from a
    request, and is joined to nothing a caller supplied."""
    return os.path.join(directory(), name)


def _decoded(raw: bytes) -> Image.Image:
    """The uploaded bytes as pixels, or the refusal saying they are not.

    A decoder either produces an image or it does not, which is the only check
    worth making. Everything else about an upload is somebody's word for it.
    """
    try:
        # verify() leaves the object unusable, so it is opened twice: once to
        # check the file is whole, once to work with.
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
        image = Image.open(io.BytesIO(raw))
    except (
        Image.DecompressionBombError,
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
    ) as failure:
        raise RejectedImage("That file is not an image this server can read.") from failure

    # The declared size comes out of the header, so an absurd canvas is refused
    # before a single pixel is decoded.
    width, height = image.size
    if width < 1 or height < 1:
        raise RejectedImage("That image has no size.")
    if width * height > MAX_PIXELS:
        raise RejectedImage("That image is too large to work with.")

    try:
        image.load()
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as failure:
        raise RejectedImage("That file is not an image this server can read.") from failure

    # Rotated before anything is cropped or re-encoded: the orientation lives in
    # metadata, and the metadata is about to be dropped, so a photo taken
    # sideways would stay sideways for good.
    return ImageOps.exif_transpose(image).convert("RGB")


def _fitted(image: Image.Image, max_edge: int) -> Image.Image:
    """Scaled so the longest edge is at most max_edge, never enlarged: growing a
    small picture invents detail and pays bytes for it."""
    width, height = image.size
    longest = max(width, height)
    if longest <= max_edge:
        return image
    factor = max_edge / longest
    return image.resize(
        (max(1, round(width * factor)), max(1, round(height * factor))), Image.Resampling.LANCZOS
    )


def encode(raw: bytes, max_edge: int) -> bytes:
    """The webp this server will serve, built from the bytes that arrived."""
    fitted = _fitted(_decoded(raw), max_edge)
    # Pasted onto a blank canvas rather than converted: a converted image keeps
    # its source's info dictionary and Pillow writes parts of it back out. A
    # fresh canvas has nothing to carry, so the camera model, the timestamp and
    # the coordinates the photo was taken at all stop here.
    clean = Image.new("RGB", fitted.size)
    clean.paste(fitted)
    out = io.BytesIO()
    clean.save(out, format="WEBP", quality=QUALITY, method=4)
    return out.getvalue()


def store(raw: bytes, purpose: str) -> str:
    """Encode an upload, write it, and answer with the name it was given.

    The name is random rather than derived from a row id: the file is written
    before the row exists, so that an upload this server will not store never
    leaves an id behind.
    """
    encoded = encode(raw, MAX_EDGES[purpose])
    folder = directory()
    os.makedirs(folder, exist_ok=True)
    name = f"{secrets.token_hex(16)}{SUFFIX}"
    # Written under a scratch name and renamed into place, so a request dying
    # halfway cannot leave a half-written file where a whole one is expected.
    handle, temporary = tempfile.mkstemp(dir=folder, prefix="upload-", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(encoded)
        os.replace(temporary, path_for(name))
    except OSError:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise
    return name


def remove(name: str) -> None:
    """Delete one stored photo. Already gone is not a failure."""
    try:
        os.remove(path_for(name))
    except FileNotFoundError:
        pass
    except OSError:
        # The row decides whether a photo exists. A file that will not go is
        # something for whoever runs the instance, not a reason to fail the
        # request that removed the row.
        log.warning("Could not delete photo %s", name)
