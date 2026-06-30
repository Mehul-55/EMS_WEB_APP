from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pymongo.errors import DuplicateKeyError

from app.config import get_settings
from app.database import employees_col
from app.schemas import LoginRequest, PasswordChange, ProfileUpdate
from app.security import ACCESS_TOKEN_COOKIE_NAME, create_access_token, get_current_user, hash_password, verify_password
from app.utils import active_employee_query, employee_identity_query, log_audit, serialize_doc, utc_now


router = APIRouter(prefix="/auth", tags=["auth"])
_login_attempts: dict[str, dict[str, datetime | int]] = {}


def _login_identifier(payload: LoginRequest) -> str:
    if payload.username:
        return payload.username.strip().lower()
    if payload.employee_id is not None:
        return str(payload.employee_id)
    return "unknown"


def _login_rate_limit_key(request: Request, payload: LoginRequest) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{client_host}:{_login_identifier(payload)}"


def _check_login_rate_limit(key: str) -> None:
    settings = get_settings()
    window_start = utc_now() - timedelta(seconds=settings.login_rate_limit_window_seconds)
    attempt = _login_attempts.get(key)
    if not attempt:
        return
    last_failed_at = attempt.get("last_failed_at")
    if not isinstance(last_failed_at, datetime) or last_failed_at < window_start:
        _login_attempts.pop(key, None)
        return
    count = int(attempt.get("count", 0))
    if count >= settings.login_rate_limit_attempts:
        unlock_at = last_failed_at + timedelta(seconds=settings.login_rate_limit_window_seconds)
        retry_after = max(int((unlock_at - utc_now()).total_seconds()), 1)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


def _record_failed_login(key: str) -> None:
    settings = get_settings()
    now = utc_now()
    window_start = now - timedelta(seconds=settings.login_rate_limit_window_seconds)
    attempt = _login_attempts.get(key)
    if not attempt or not isinstance(attempt.get("last_failed_at"), datetime) or attempt["last_failed_at"] < window_start:
        _login_attempts[key] = {"count": 1, "last_failed_at": now}
        return
    attempt["count"] = int(attempt.get("count", 0)) + 1
    attempt["last_failed_at"] = now


def _clear_failed_login(key: str) -> None:
    _login_attempts.pop(key, None)


def bootstrap_admin() -> None:
    settings = get_settings()
    now = utc_now()

    existing = employees_col.find_one(employee_identity_query(settings.admin_employee_id))
    if not existing:
        existing = employees_col.find_one(
            {
                "$or": [
                    {"username": settings.admin_username},
                    {"email": settings.admin_email},
                ],
                "role": "admin",
            }
        )

    if existing:
        employees_col.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "employee_id": settings.admin_employee_id,
                    "emp_id": str(settings.admin_employee_id),
                    "username": settings.admin_username,
                    "name": settings.admin_name,
                    "email": settings.admin_email,
                    "department": "Administration",
                    "basic_salary": existing.get("basic_salary", 0),
                    "role": "admin",
                    "deleted": False,
                    "updated_at": now,
                }
            },
        )
        return

    employees_col.insert_one(
        {
            "employee_id": settings.admin_employee_id,
            "emp_id": str(settings.admin_employee_id),
            "username": settings.admin_username,
            "name": settings.admin_name,
            "email": settings.admin_email,
            "department": "Administration",
            "basic_salary": 0,
            "role": "admin",
            "password_hash": hash_password(settings.admin_password),
            "joining_date": now.date().isoformat(),
            "deleted": False,
            "created_at": now,
            "updated_at": now,
        }
    )


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    rate_limit_key = _login_rate_limit_key(request, payload)
    _check_login_rate_limit(rate_limit_key)
    if payload.username:
        user = employees_col.find_one(
            {
                "$or": [
                    {"username": payload.username},
                    {"email": payload.username},
                ],
                "role": "admin",
                "deleted": {"$ne": True},
            }
        )
    elif payload.employee_id is not None:
        user = employees_col.find_one(active_employee_query(payload.employee_id))
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or employee ID is required.")
    stored_password = (user or {}).get("password_hash") or (user or {}).get("password")
    if not user or not verify_password(stored_password, payload.password):
        _record_failed_login(rate_limit_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid employee ID or password.")

    _clear_failed_login(rate_limit_key)
    employee_id = serialize_doc(user)["employee_id"]
    token = create_access_token(
        subject=str(employee_id),
        role=user.get("role", "employee"),
        employee_id=employee_id,
    )
    settings = get_settings()
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
    )
    serialized_user = serialize_doc(user)
    log_audit(serialized_user, "login", "auth", employee_id, {"role": serialized_user.get("role")})
    return {"user": serialized_user}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(ACCESS_TOKEN_COOKIE_NAME, path="/")
    return {"message": "Logged out successfully."}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return serialize_doc(current_user)


@router.patch("/me/profile")
def update_profile(payload: ProfileUpdate, current_user=Depends(get_current_user)):
    allowed = payload.model_dump(exclude_unset=True)
    updates = {
        key: value
        for key, value in allowed.items()
        if value is not None
    }
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No profile fields provided.")
    updates["updated_at"] = utc_now()
    employee_id = serialize_doc(current_user)["employee_id"]
    employees_col.update_one(employee_identity_query(employee_id), {"$set": updates})
    updated = serialize_doc(employees_col.find_one(employee_identity_query(employee_id)))
    log_audit(current_user, "profile_updated", "employee", employee_id, {"fields": sorted(updates.keys())})
    return updated


@router.post("/change-password")
def change_password(payload: PasswordChange, current_user=Depends(get_current_user)):
    if not verify_password(current_user.get("password_hash"), payload.old_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Old password is incorrect.")
    employees_col.update_one(
        employee_identity_query(serialize_doc(current_user)["employee_id"]),
        {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": utc_now()}},
    )
    log_audit(current_user, "password_changed", "employee", serialize_doc(current_user)["employee_id"])
    return {"message": "Password changed successfully."}


@router.post("/bootstrap-admin")
def create_initial_admin():
    if employees_col.find_one({"role": "admin"}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Admin already exists.")
    try:
        bootstrap_admin()
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configured admin employee ID/email already exists.") from exc
    log_audit(None, "admin_bootstrapped", "employee")
    return {"message": "Admin created successfully."}
