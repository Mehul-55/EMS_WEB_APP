from fastapi import APIRouter, Depends, Query

from app.database import audit_logs_col
from app.security import require_admin
from app.utils import serialize_docs


router = APIRouter(prefix="/audit-logs", tags=["audit logs"])


@router.get("", dependencies=[Depends(require_admin)])
def list_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=5, le=100),
    action: str | None = None,
    entity_type: str | None = None,
):
    query = {}
    if action:
        query["action"] = action
    if entity_type:
        query["$or"] = [{"entity_type": entity_type}, {"target": {"$regex": f"^{entity_type}", "$options": "i"}}]

    total = audit_logs_col.count_documents(query)
    skip = (page - 1) * page_size
    docs = serialize_docs(
        audit_logs_col
        .find(query)
        .sort([("timestamp", -1), ("created_at", -1)])
        .skip(skip)
        .limit(page_size)
    )
    rows = [_audit_log_row(doc) for doc in docs]
    return {
        "rows": rows,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max((total + page_size - 1) // page_size, 1),
    }


def _audit_log_row(doc: dict) -> dict:
    return {
        "action": doc.get("action"),
        "performed_by": doc.get("performed_by") or doc.get("actor_name") or doc.get("actor_employee_id"),
        "target": doc.get("target") or _legacy_target(doc),
        "details": _details_text(doc.get("details") if doc.get("details") is not None else doc.get("details_raw")),
        "timestamp": doc.get("timestamp") or doc.get("created_at"),
    }


def _legacy_target(doc: dict) -> str:
    entity_type = doc.get("entity_type")
    entity_id = doc.get("entity_id")
    if entity_type and entity_id:
        return f"{entity_type}:{entity_id}"
    return entity_type or entity_id or "-"


def _details_text(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, dict):
        return " | ".join(
            f"{str(key).replace('_', ' ').title()}: {item}"
            for key, item in value.items()
            if item is not None
        ) or "-"
    return str(value) or "-"
