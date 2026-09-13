from collections.abc import Awaitable, Callable

from fastapi import Depends, FastAPI, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth.csrf import csrf_guard
from .auth.rate_limit import LoginRateLimiter
from .auth.router import router as auth_router
from .accounts import router as accounts_router
from .transactions import router as transactions_router
from .categories import router as categories_router
from .auth.sessions import clear_auth_cookies
from .config import Settings, get_settings
from .db import get_db
from .errors import register_exception_handlers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="Household Budget Tracker API",
        docs_url=None if settings.app_env == "production" else "/docs",
        redoc_url=None if settings.app_env == "production" else "/redoc",
        dependencies=[Depends(csrf_guard)],
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.state.login_limiter = LoginRateLimiter()
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    register_exception_handlers(app)

    @app.middleware("http")
    async def auth_response_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if getattr(request.state, "clear_auth_cookies", False):
            clear_auth_cookies(response)
        if request.url.path.startswith("/api/auth/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health(db: Session = Depends(get_db)) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(accounts_router)
    app.include_router(categories_router)
    app.include_router(transactions_router)
    return app


app = create_app()
