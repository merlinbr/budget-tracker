from collections.abc import Awaitable, Callable
import os

from fastapi import Depends, FastAPI, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .auth.csrf import csrf_guard
from .auth.rate_limit import LoginRateLimiter
from .auth.router import router as auth_router
from .accounts import router as accounts_router
from .budgets import router as budgets_router
from .dashboard import router as dashboard_router
from .export import router as export_router
from .settings import router as settings_router
from .transactions import router as transactions_router
from .categories import router as categories_router
from .auth.sessions import clear_auth_cookies
from .config import Settings, get_settings
from .db import get_db
from .errors import register_exception_handlers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    production = settings.app_env == "production"
    app = FastAPI(
        title="Household Budget Tracker API",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
        dependencies=[Depends(csrf_guard)],
    )
    app.dependency_overrides[get_settings] = lambda: settings
    # The real browser suite deliberately performs several failed logins
    # (old-password checks). Relax its disposable test server only; unit
    # tests and production keep the five-failure policy.
    browser_e2e = (
        settings.app_env == "test"
        and os.environ.get("E2E_BROWSER_MODE") == "1"
    )
    limiter_kwargs = (
        {"max_failures": 100, "window_seconds": 60.0} if browser_e2e else {}
    )
    app.state.login_limiter = LoginRateLimiter(**limiter_kwargs)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    register_exception_handlers(app)

    @app.middleware("http")
    async def auth_response_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if getattr(request.state, "clear_auth_cookies", False):
            clear_auth_cookies(response)
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.get("/api/health")
    def health(db: Session = Depends(get_db)) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(settings_router)
    app.include_router(accounts_router)
    app.include_router(categories_router)
    app.include_router(transactions_router)
    app.include_router(dashboard_router)
    app.include_router(budgets_router)
    app.include_router(export_router)
    return app


app = create_app()
