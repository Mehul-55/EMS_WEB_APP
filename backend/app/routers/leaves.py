from datetime import date

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import employees_col, leave_requests_col, leaves_col
from app.schemas import LeaveRequestCreate, LeaveReview, LeaveRevertRequest
from app.security import get_current_user, require_admin
from app.utils import active_employee_query, employee_identity_query, log_audit, serialize_doc, serialize_docs, today_string, utc_now


router = APIRouter(prefix="/leaves", tags=["leaves"])


def _employee_id(doc: dict) -> str:
    return str(doc.get("employee_id") or doc.get("emp_id") or "")


def _number(value, default=0.0):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _leave_days(leave: dict) -> float:
    if leave.get("days") is not None:
        return _number(leave.get("days"))
    duration = str(leave.get("duration") or leave.get("leave_duration") or "Full Day").lower()
    day_value = 0.25 if "quarter" in duration else 0.5 if "half" in duration else 1.0
    try:
        start = date.fromisoformat(str(leave.get("from_date"))[:10])
        end = date.fromisoformat(str(leave.get("to_date"))[:10])
    except (TypeError, ValueError):
        return day_value
    return max((end - start).days + 1, 1) * day_value


@router.post("", status_code=status.HTTP_201_CREATED)
def submit_leave(payload: LeaveRequestCreate, current_user=Depends(get_current_user)):
    if payload.to_date < payload.from_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="To date cannot be before from date.")
    if payload.from_date <= date.fromisoformat(today_string()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leave requests must be submitted at least one day before the leave date.",
        )
    now = utc_now()
    doc = payload.model_dump()
    doc["from_date"] = payload.from_date.isoformat()
    doc["to_date"] = payload.to_date.isoformat()
    doc.update(
        {
            "employee_id": serialize_doc(current_user)["employee_id"],
            "emp_id": str(serialize_doc(current_user)["employee_id"]),
            "emp_name": current_user.get("name"),
            "status": "Pending",
            "submitted_on": now,
            "created_at": now,
            "updated_at": now,
        }
    )
    result = leave_requests_col.insert_one(doc)
    created = serialize_doc(leave_requests_col.find_one({"_id": result.inserted_id}))
    log_audit(current_user, "leave_requested", "leave", created.get("id"), {"employee_id": created.get("employee_id"), "from_date": created.get("from_date"), "to_date": created.get("to_date")})
    return created


@router.get("")
def list_leaves(
    employee_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    from_date: date | None = None,
    to_date: date | None = None,
    current_user=Depends(get_current_user),
):
    query = {}
    if current_user.get("role") != "admin":
        query = employee_identity_query(serialize_doc(current_user)["employee_id"])
    elif employee_id:
        query = employee_identity_query(employee_id)
    if status_filter:
        query["status"] = status_filter
    if from_date or to_date:
        query["from_date"] = {}
        if from_date:
            query["from_date"]["$gte"] = from_date.isoformat()
        if to_date:
            query["from_date"]["$lte"] = to_date.isoformat()
    return serialize_docs(leave_requests_col.find(query).sort([("submitted_on", -1), ("created_at", -1)]))


@router.get("/balances", dependencies=[Depends(require_admin)])
def leave_balances():
    employees = serialize_docs(employees_col.find({"deleted": {"$ne": True}, "role": {"$ne": "admin"}}))
    balances = serialize_docs(leaves_col.find({}))
    balance_by_emp = {_employee_id(balance): balance for balance in balances}
    rows = []
    for employee in sorted(employees, key=lambda item: str(item.get("employee_id") or item.get("emp_id") or "")):
        emp_id = _employee_id(employee)
        balance = balance_by_emp.get(emp_id, {})
        approved_days = sum(
            _leave_days(leave)
            for leave in serialize_docs(
                leave_requests_col.find(
                    {
                        "$and": [
                            employee_identity_query(employee.get("employee_id") or employee.get("emp_id")),
                            {"status": "Approved"},
                        ]
                    }
                )
            )
        )
        used = max(_number(balance.get("used_leaves")), approved_days)
        total = _number(balance.get("total_leaves"))
        rows.append(
            {
                "employee_id": employee.get("employee_id") or employee.get("emp_id"),
                "name": employee.get("name") or employee.get("emp_name") or "N/A",
                "department": employee.get("department") or "N/A",
                "total": total,
                "used": used,
                "remaining": max(total - used, 0),
                "has_record": bool(balance),
            }
        )
    return {"rows": rows}


@router.put("/balances/{employee_id}")
def set_leave_balance(employee_id: int, payload: dict, current_user=Depends(require_admin)):
    employee = employees_col.find_one(active_employee_query(employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    total_leaves = _number(payload.get("total_leaves"), -1)
    if total_leaves < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Total leaves cannot be negative.")
    leaves_col.update_one(
        {"emp_id": employee_id},
        {
            "$set": {
                "emp_id": employee_id,
                "employee_id": employee_id,
                "total_leaves": total_leaves,
                "updated_at": utc_now(),
            },
            "$setOnInsert": {"used_leaves": 0, "created_at": utc_now()},
        },
        upsert=True,
    )
    balance = serialize_doc(leaves_col.find_one({"emp_id": employee_id}))
    log_audit(current_user, "leave_balance_updated", "leave_balance", employee_id, {"total_leaves": total_leaves})
    return balance


@router.get("/{leave_id}")
def get_leave(leave_id: str, current_user=Depends(get_current_user)):
    leave = _leave_or_404(leave_id)
    leave_employee_id = serialize_doc(leave)["employee_id"]
    if current_user.get("role") != "admin" and leave_employee_id != serialize_doc(current_user)["employee_id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own leave requests.")
    return serialize_doc(leave)


@router.patch("/{leave_id}/review")
def review_leave(leave_id: str, payload: LeaveReview, current_user=Depends(require_admin)):
    leave = _leave_or_404(leave_id)
    if not employees_col.find_one(active_employee_query(serialize_doc(leave)["employee_id"])):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee no longer exists.")
    leave_requests_col.update_one(
        {"_id": leave["_id"]},
        {
            "$set": {
                "status": payload.status,
                "remarks": payload.remarks,
                "reviewed_at": utc_now(),
                "updated_at": utc_now(),
            }
        },
    )
    updated = serialize_doc(leave_requests_col.find_one({"_id": leave["_id"]}))
    log_audit(current_user, "leave_reviewed", "leave", leave_id, {"status": payload.status, "employee_id": updated.get("employee_id")})
    return updated


@router.patch("/{leave_id}/cancel")
def cancel_leave(leave_id: str, current_user=Depends(get_current_user)):
    leave = _leave_or_404(leave_id)
    leave_employee_id = serialize_doc(leave)["employee_id"]
    if current_user.get("role") != "admin" and leave_employee_id != serialize_doc(current_user)["employee_id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only cancel your own leave requests.")
    if leave.get("status") != "Pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending leaves can be cancelled.")
    leave_requests_col.update_one(
        {"_id": leave["_id"]},
        {"$set": {"status": "Cancelled", "updated_at": utc_now()}},
    )
    updated = serialize_doc(leave_requests_col.find_one({"_id": leave["_id"]}))
    log_audit(current_user, "leave_cancelled", "leave", leave_id, {"employee_id": updated.get("employee_id")})
    return updated


@router.patch("/{leave_id}/revert")
def revert_leave(leave_id: str, payload: LeaveRevertRequest, current_user=Depends(get_current_user)):
    leave = _leave_or_404(leave_id)
    leave_employee_id = serialize_doc(leave)["employee_id"]
    if current_user.get("role") != "admin" and leave_employee_id != serialize_doc(current_user)["employee_id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only revert your own leave requests.")
    if leave.get("status") != "Approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only approved leaves can be reverted.")
    leave_requests_col.update_one(
        {"_id": leave["_id"]},
        {
            "$set": {
                "status": "Revert Requested",
                "revert_reason": payload.reason,
                "revert_requested_at": utc_now(),
                "updated_at": utc_now(),
            }
        },
    )
    updated = serialize_doc(leave_requests_col.find_one({"_id": leave["_id"]}))
    log_audit(current_user, "leave_revert_requested", "leave", leave_id, {"employee_id": updated.get("employee_id")})
    return updated


def _leave_or_404(leave_id: str) -> dict:
    try:
        object_id = ObjectId(leave_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid leave ID.") from exc
    leave = leave_requests_col.find_one({"_id": object_id})
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
    return leave
