from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_JWT_SECRET_KEY = "change-this-secret-before-production"
DEFAULT_ADMIN_PASSWORD = "admin123"
DEFAULT_CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"


class Settings(BaseSettings):
    app_env: str = "development"
    mongo_uri: str = "mongodb://localhost:27017/"
    mongo_db_name: str = "ems_web"
    jwt_secret_key: str = DEFAULT_JWT_SECRET_KEY
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 900
    cors_allowed_origins: str = DEFAULT_CORS_ALLOWED_ORIGINS
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    admin_employee_id: int = 777
    admin_username: str = "admin"
    admin_name: str = "Admin"
    admin_email: str = "admin@example.com"
    admin_password: str = DEFAULT_ADMIN_PASSWORD

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @model_validator(mode="after")
    def validate_production_settings(self):
        cookie_samesite = self.cookie_samesite.lower()
        if cookie_samesite not in {"strict", "lax", "none"}:
            raise ValueError("COOKIE_SAMESITE must be one of: strict, lax, none.")

        if self.app_env.lower() not in {"production", "prod"}:
            return self
        if self.jwt_secret_key == DEFAULT_JWT_SECRET_KEY:
            raise ValueError("JWT_SECRET_KEY must be changed in production.")
        if self.admin_password == DEFAULT_ADMIN_PASSWORD:
            raise ValueError("ADMIN_PASSWORD must be changed in production.")
        if not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production.")
        if not self.allowed_cors_origins() or self.cors_allowed_origins == DEFAULT_CORS_ALLOWED_ORIGINS:
            raise ValueError("CORS_ALLOWED_ORIGINS must be set to your production frontend origin.")
        if cookie_samesite != "none":
            raise ValueError("COOKIE_SAMESITE must be none in production so cross-domain frontend requests include the login cookie.")
        if any(origin in self.allowed_cors_origins() for origin in DEFAULT_CORS_ALLOWED_ORIGINS.split(",")):
            raise ValueError("CORS_ALLOWED_ORIGINS must not include local development origins in production.")
        return self

    def allowed_cors_origins(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
