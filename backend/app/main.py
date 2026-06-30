import logging

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_indexes, ping_database
from app.routers import attendance, audit_logs, auth, employees, leaves, reports, shifts
from app.routers.auth import bootstrap_admin


settings = get_settings()
app = FastAPI(title="EMS Web Backend API", version="0.1.0")
logger = logging.getLogger(__name__)
startup_database_error: str | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    global startup_database_error
    try:
        init_indexes()
        bootstrap_admin()
        startup_database_error = None
    except Exception as exc:
        startup_database_error = f"{type(exc).__name__}: {exc}"
        logger.exception("Backend database startup failed")


@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "service": "EMS Web Backend API"}


@app.get("/health", tags=["health"])
def health():
    if startup_database_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database startup failed: {startup_database_error}",
        )
    try:
        ping_database()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database ping failed: {type(exc).__name__}: {exc}",
        ) from exc
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/v1")
app.include_router(employees.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(shifts.router, prefix="/api/v1")
app.include_router(leaves.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
