from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_indexes, ping_database
from app.routers import attendance, audit_logs, auth, employees, leaves, reports, shifts
from app.routers.auth import bootstrap_admin


settings = get_settings()
app = FastAPI(title="EMS Web Backend API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_indexes()
    bootstrap_admin()


@app.get("/", tags=["health"])
def root():
    return {"status": "ok", "service": "EMS Web Backend API"}


@app.get("/health", tags=["health"])
def health():
    ping_database()
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/v1")
app.include_router(employees.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(shifts.router, prefix="/api/v1")
app.include_router(leaves.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
