from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId

from app.database import audit_logs_col

APP_TIMEZONE = ZoneInfo("Asia/Kolkata")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def local_now() -> datetime:
    return datetime.now(APP_TIMEZONE)


def local_time_string(value: datetime | None = None) -> str:
    current = value or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(APP_TIMEZONE).strftime("%H:%M")


def today_string() -> str:
    return local_now().date().isoformat()


def serialize_doc(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if doc is None:
        return None
    result = dict(doc)
    if "_id" in result and isinstance(result["_id"], ObjectId):
        result["id"] = str(result.pop("_id"))
    normalize_legacy_doc(result)
    for key, value in list(result.items()):
        if isinstance(value, datetime):
            normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            result[key] = normalized.isoformat()
        elif isinstance(value, date):
            result[key] = value.isoformat()
    result.pop("password", None)
    result.pop("password_hash", None)
    return result


def serialize_docs(docs) -> list[dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]


def log_audit(
    actor: dict[str, Any] | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    details: dict[str, Any] | None = None,
) -> None:
    actor_doc = serialize_doc(actor) if actor else {}
    performed_by = (
        actor_doc.get("username") or
        actor_doc.get("name") or
        actor_doc.get("employee_id") or
        actor_doc.get("emp_id") or
        "System"
    )
    target = f"{entity_type}:{entity_id}" if entity_id is not None else entity_type
    detail_text = _audit_detail_text(details)
    timestamp = utc_now()
    try:
        audit_logs_col.insert_one(
            {
                "action": str(action or "").upper(),
                "performed_by": str(performed_by),
                "target": target,
                "details": detail_text,
                "timestamp": timestamp,
                "entity_type": entity_type,
                "entity_id": str(entity_id) if entity_id is not None else None,
                "actor_employee_id": actor_doc.get("employee_id") or actor_doc.get("emp_id"),
                "actor_name": actor_doc.get("name") or actor_doc.get("username") or "System",
                "actor_role": actor_doc.get("role") or "system",
                "details_raw": details or {},
                "created_at": timestamp,
            }
        )
    except Exception:
        return


def _audit_detail_text(details: dict[str, Any] | None) -> str:
    if not details:
        return "-"
    return " | ".join(
        f"{str(key).replace('_', ' ').title()}: {value}"
        for key, value in details.items()
        if value is not None
    ) or "-"


def clean_update(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def normalize_employee_id(value: Any) -> int | str:
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    return int(text) if text.isdigit() else text


def employee_sort_key(item: dict[str, Any]) -> tuple[int, int | str]:
    employee_id = normalize_employee_id(item.get("employee_id") or item.get("emp_id"))
    return (0, employee_id) if isinstance(employee_id, int) else (1, str(employee_id))


def employee_identity_query(employee_id: int | str) -> dict[str, Any]:
    normalized = normalize_employee_id(employee_id)
    values = {normalized, str(normalized)}
    if isinstance(normalized, int):
        values.add(str(normalized))
    return {"$or": [{"employee_id": value} for value in values] + [{"emp_id": value} for value in values]}


def active_employee_query(employee_id: int | str | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {"deleted": {"$ne": True}}
    if employee_id is not None:
        query = {"$and": [query, employee_identity_query(employee_id)]}
    return query


def normalize_legacy_doc(result: dict[str, Any]) -> dict[str, Any]:
    if "employee_id" not in result and result.get("emp_id") is not None:
        result["employee_id"] = normalize_employee_id(result.get("emp_id"))
    if "emp_id" not in result and result.get("employee_id") is not None:
        result["emp_id"] = str(result.get("employee_id"))
    if "work_date" not in result and result.get("date") is not None:
        result["work_date"] = result.get("date")
    if "date" not in result and result.get("work_date") is not None:
        result["date"] = result.get("work_date")
    if "check_in" not in result and result.get("arrival_time") is not None:
        result["check_in"] = result.get("arrival_time")
    if "check_out" not in result and result.get("checkout_time") is not None:
        result["check_out"] = result.get("checkout_time")
    if "name" not in result and result.get("emp_name") is not None:
        result["name"] = result.get("emp_name")
    result.setdefault("deleted", False)
    return result
