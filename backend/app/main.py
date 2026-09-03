"""The application: its guards, its one error shape, and its only route."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import mail
from app.config import VERSION, check_deploy_config
from app.routers import (
    account,
    admin,
    auth,
    barcode,
    diary,
    feedback,
    foods,
    health,
    invites,
    meals,
    photos,
    recipes,
    submissions,
)

# A JSON body that needs more than this is a mistake or an attack. The reverse
# proxy caps /api/ at the same figure; this is the cap that holds when the proxy
# is not in front.
MAX_BODY_BYTES = 64 * 1024

# The one address that takes a file, and the ceiling it takes one under. A
# little above the ten megabytes the photo route itself allows, so an upload
# that is merely too big is refused by that route's own sentence rather than by
# a body cut off mid-stream.
UPLOAD_PATH = "/api/photos"
MAX_UPLOAD_BYTES = 11 * 1024 * 1024

_TOO_LARGE = b'{"detail":"Request body is too large."}'


async def _refuse(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_TOO_LARGE)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _TOO_LARGE})


class BodySizeLimitMiddleware:
    """Stops an oversized body before anything holds it in memory.

    Written against the raw ASGI interface rather than as a dependency so it
    runs ahead of body parsing: a request that declares its length is refused
    without reading a byte, and one that arrives chunked is measured as it
    streams. Both paths matter, because Content-Length is the sender's claim
    and a sender that wants to overwhelm this can simply omit it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return

        # Which ceiling this address is held to. Only the upload route gets the
        # larger one, and it is chosen by exact path so nothing underneath it
        # inherits the allowance.
        ceiling = MAX_UPLOAD_BYTES if scope.get("path") == UPLOAD_PATH else MAX_BODY_BYTES

        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > ceiling:
                    await _refuse(send)
                    return
            except ValueError:
                # A header that is not a number settles nothing; the streamed
                # count below is the guard that cannot be lied to.
                pass

        counted = 0
        overflowed = False

        async def counting_receive() -> Message:
            nonlocal counted, overflowed
            message = await receive()
            if message.get("type") == "http.request":
                counted += len(message.get("body", b""))
                if counted > ceiling:
                    # The stream is ended rather than raised out of: an
                    # exception here would surface as a 500 from inside the
                    # handler. A truncated body fails to parse instead, and the
                    # 400 that produces is corrected below.
                    overflowed = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def correcting_send(message: Message) -> None:
            if (
                overflowed
                and message["type"] == "http.response.start"
                and message["status"] == 400
            ):
                message = {**message, "status": 413}
            await send(message)

        await self.app(scope, counting_receive, correcting_send)


async def _validation_error(request: Request, exc: Exception) -> JSONResponse:
    """Answer a malformed body in the same shape as every other error.

    The framework default is a 422 whose detail is a list of field objects, so
    a client would need two ways to read an error. The field paths are dropped
    on purpose: they describe a body the caller already has, and they map out
    the API for anyone probing it.
    """
    return JSONResponse(status_code=400, content={"detail": "Request body is missing or malformed."})


# The refusals nobody raises by hand, and what they say instead. The framework
# words these as bare labels rather than sentences, and a client should never
# have to read two kinds of error text.
_FRAMEWORK_DETAIL = {
    "Not Found": "There is nothing at this address.",
    "Method Not Allowed": "That is not something this address accepts.",
}


async def _http_error(request: Request, exc: Exception) -> JSONResponse:
    """Every refusal in one shape: a detail, and one sentence in it."""
    assert isinstance(exc, StarletteHTTPException)
    detail = exc.detail if isinstance(exc.detail, str) else ""
    detail = _FRAMEWORK_DETAIL.get(detail, detail) or "Something went wrong."
    # The headers ride along: a 405 carries the Allow header, and dropping it
    # would leave the answer incomplete.
    return JSONResponse(
        status_code=exc.status_code, content={"detail": detail}, headers=exc.headers
    )


def create_app() -> FastAPI:
    # Before an engine, a route, or a port. A refusal here stops the process
    # rather than letting a misconfigured install answer a single request.
    check_deploy_config()

    app = FastAPI(
        title="Tare",
        version=VERSION,
        # No /docs, /redoc, or /openapi.json: an unauthenticated map of every
        # route is not worth the convenience, and a route that is not served
        # cannot be reached by a proxy configured wrongly.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)

    @app.get("/api/version")
    def read_version() -> dict[str, object]:
        # Whether this instance can send mail, which is the one thing the
        # sign-in screen has to know before it can offer a reset link it may
        # have nowhere to send.
        return {"version": VERSION, "mail": mail.configured()}

    # Every route lives under /api, which is the prefix the web container
    # forwards and the only one the browser ever calls.
    app.include_router(auth.router, prefix="/api")
    app.include_router(invites.router, prefix="/api")
    app.include_router(account.router, prefix="/api")
    app.include_router(foods.router, prefix="/api")
    app.include_router(diary.router, prefix="/api")
    app.include_router(feedback.router, prefix="/api")
    app.include_router(health.router, prefix="/api")
    app.include_router(recipes.router, prefix="/api")
    app.include_router(meals.router, prefix="/api")
    app.include_router(barcode.router, prefix="/api")
    app.include_router(photos.router, prefix="/api")
    app.include_router(submissions.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")

    return app


app = create_app()
