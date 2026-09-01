"""The application: its guards, its one error shape, and its only route."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import VERSION, check_deploy_config

# Nothing here accepts a file yet, and a JSON body that needs more than this is
# a mistake or an attack. The reverse proxy caps /api/ at the same figure; this
# is the cap that holds when the proxy is not in front.
MAX_BODY_BYTES = 64 * 1024

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

        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > MAX_BODY_BYTES:
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
                if counted > MAX_BODY_BYTES:
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


def create_app() -> FastAPI:
    # Before an engine, a route, or a port. A refusal here stops the process
    # rather than letting a misconfigured install answer a single request.
    check_deploy_config()

    app = FastAPI(
        title="tare",
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

    @app.get("/api/version")
    def read_version() -> dict[str, str]:
        return {"version": VERSION}

    return app


app = create_app()
