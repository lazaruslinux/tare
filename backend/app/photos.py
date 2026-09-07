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
# on a shelf at thumbnail size and does not. A dish is looked at the way a
# front is. Beyond this is bytes nobody looks at.
MAX_EDGES = {"front": 1200, "label": 1600, "dish": 1200, "avatar": 512}
QUALITY = 78

# The small copy of a front photo, written beside it. A list of forty rows
# draws forty of these, and none of them is worth the full picture: square,
# because a row draws it in a square box, and cheap enough that the whole list
# costs less than one of the pictures it stands for.
THUMB_EDGE = 96
THUMB_QUALITY = 70
THUMB_SUFFIX = ".thumb.webp"

# Which kinds get one. A label is read at full size and an avatar is already
# small, so it is the kinds a list draws in a row that are worth a second file.
THUMBED = ("front", "dish")

# What is stored as a square, cropped to the middle of whatever arrived. An
# avatar is drawn in a square box everywhere it appears, so the shape is
# settled once here rather than left to every screen that shows one. The
# member frames their own picture before it is sent; this is the guard for
# everything that did not come from that screen.
SQUARE = ("avatar",)

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


def thumb_name(name: str) -> str:
    """What the small copy of a stored photo is called, beside it."""
    return name.removesuffix(SUFFIX) + THUMB_SUFFIX


def stored(name: str) -> bool:
    """Whether that file is on the disk. A thumb is written after the picture
    it is of, and the ones from before there were any are written by hand, so
    a list has to ask rather than assume."""
    return os.path.isfile(path_for(name))


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


def _centred(image: Image.Image) -> Image.Image:
    """The largest square in the middle of the picture."""
    width, height = image.size
    edge = min(width, height)
    left = (width - edge) // 2
    top = (height - edge) // 2
    return image.crop((left, top, left + edge, top + edge))


def encode(raw: bytes, max_edge: int, square: bool = False, quality: int = QUALITY) -> bytes:
    """The webp this server will serve, built from the bytes that arrived."""
    decoded = _decoded(raw)
    fitted = _fitted(_centred(decoded) if square else decoded, max_edge)
    # Pasted onto a blank canvas rather than converted: a converted image keeps
    # its source's info dictionary and Pillow writes parts of it back out. A
    # fresh canvas has nothing to carry, so the camera model, the timestamp and
    # the coordinates the photo was taken at all stop here.
    clean = Image.new("RGB", fitted.size)
    clean.paste(fitted)
    out = io.BytesIO()
    clean.save(out, format="WEBP", quality=quality, method=4)
    return out.getvalue()


def _write(name: str, data: bytes) -> None:
    """One file into the photo directory, whole or not at all.

    Written under a scratch name and renamed into place, so a request dying
    halfway cannot leave a half-written file where a whole one is expected.
    """
    folder = directory()
    os.makedirs(folder, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=folder, prefix="upload-", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(temporary, path_for(name))
    except OSError:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


def write_thumb(raw: bytes, name: str) -> None:
    """Write the small square copy of one stored photo, beside it.

    Built from the bytes that arrived rather than from the stored picture: the
    original has the detail, and a 96 px square cut out of it is sharper than
    the same square cut out of something already scaled down.
    """
    _write(thumb_name(name), encode(raw, THUMB_EDGE, square=True, quality=THUMB_QUALITY))


def store(raw: bytes, purpose: str) -> str:
    """Encode an upload, write it, and answer with the name it was given.

    The name is random rather than derived from a row id: the file is written
    before the row exists, so that an upload this server will not store never
    leaves an id behind.
    """
    encoded = encode(raw, MAX_EDGES[purpose], purpose in SQUARE)
    name = f"{secrets.token_hex(16)}{SUFFIX}"
    _write(name, encoded)
    if purpose in THUMBED:
        write_thumb(raw, name)
    return name


def _unlink(name: str) -> None:
    try:
        os.remove(path_for(name))
    except FileNotFoundError:
        pass
    except OSError:
        # The row decides whether a photo exists. A file that will not go is
        # something for whoever runs the instance, not a reason to fail the
        # request that removed the row.
        log.warning("Could not delete photo %s", name)


def remove(name: str) -> None:
    """Delete one stored photo, and the small copy beside it. Already gone is
    not a failure, and a picture that never had a thumb is the ordinary case."""
    _unlink(name)
    _unlink(thumb_name(name))
