from fastapi import APIRouter, Depends, HTTPException, status

from app.database import employees_col, shift_assignments_col, sunday_work_approvals_col
from app.schemas import ShiftAssignment, SundayWorkApproval
from app.security import get_current_user, require_admin
from app.utils import active_employee_query, employee_identity_query, log_audit, serialize_doc, serialize_docs, today_string, utc_now


router = APIRouter(prefix="/shifts", tags=["shifts"])

GRACE_MINUTES = 15

SHIFTS = {
    "Morning": {"start": "09:00", "end": "17:00", "hours": 8, "grace_minutes": GRACE_MINUTES, "overnight": False},
    "Evening": {"start": "14:00", "end": "22:00", "hours": 8, "grace_minutes": GRACE_MINUTES, "overnight": False},
    "Night": {"start": "22:00", "end": "06:00", "hours": 8, "grace_minutes": GRACE_MINUTES, "overnight": True},
}


@router.get("")
def list_shifts():
    return {"shifts": SHIFTS}


@router.post("/assignments")
def assign_shift(payload: ShiftAssignment, current_user=Depends(require_admin)):
    if payload.shift_name not in SHIFTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid shift name.")
    if not employees_col.find_one(active_employee_query(payload.employee_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    effective_from = (payload.effective_from.isoformat() if payload.effective_from else today_string())
    now = utc_now()
    doc = {
        "employee_id": payload.employee_id,
        "emp_id": str(payload.employee_id),
        "shift_name": payload.shift_name,
        "effective_from": effective_from,
        "updated_at": now,
    }
    shift_assignments_col.update_one(
        {"employee_id": payload.employee_id, "effective_from": effective_from},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    assignment = serialize_doc(shift_assignments_col.find_one({"employee_id": payload.employee_id, "effective_from": effective_from}))
    log_audit(current_user, "shift_assigned", "shift", assignment.get("id"), {"employee_id": payload.employee_id, "shift_name": payload.shift_name, "effective_from": effective_from})
    return assignment


@router.post("/sunday-work", dependencies=[Depends(require_admin)])
def approve_sunday_work(payload: SundayWorkApproval, current_user=Depends(get_current_user)):
    work_date = payload.work_date
    reason = payload.reason.strip()
    if work_date.weekday() != 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sunday work can only be approved for Sundays.")
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reason is required.")
    employee = employees_col.find_one(active_employee_query(payload.employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee = serialize_doc(employee)
    doc = {
        "employee_id": payload.employee_id,
        "emp_id": payload.employee_id,
        "emp_name": employee.get("name"),
        "date": work_date.isoformat(),
        "work_date": work_date.isoformat(),
        "approved_by": current_user.get("username") or current_user.get("name") or "admin",
        "reason": reason,
        "active": True,
        "updated_at": utc_now(),
    }
    sunday_work_approvals_col.update_one(
        {"emp_id": payload.employee_id, "date": work_date.isoformat()},
        {"$set": doc},
        upsert=True,
    )
    approval = serialize_doc(sunday_work_approvals_col.find_one({"emp_id": payload.employee_id, "date": work_date.isoformat()}))
    log_audit(current_user, "sunday_work_approved", "shift", approval.get("id"), {"employee_id": payload.employee_id, "work_date": work_date.isoformat()})
    return approval


@router.get("/assignments")
def list_assignments(employee_id: int | None = None, current_user=Depends(get_current_user)):
    query = {}
    if current_user.get("role") != "admin":
        query = employee_identity_query(serialize_doc(current_user)["employee_id"])
    elif employee_id:
        query = employee_identity_query(employee_id)
    rows = serialize_docs(shift_assignments_col.find(query))
    return sorted(rows, key=lambda item: (str(item.get("employee_id", "")), str(item.get("effective_from", ""))))


@router.get("/assignments/current/{employee_id}")
def current_assignment(employee_id: int, current_user=Depends(get_current_user)):
    if current_user.get("role") != "admin" and serialize_doc(current_user)["employee_id"] != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own shift.")
    assignment = shift_assignments_col.find_one(
        {"$and": [employee_identity_query(employee_id), {"effective_from": {"$lte": today_string()}}]},
        sort=[("effective_from", -1)],
    )
    if not assignment:
        return {"employee_id": employee_id, "shift_name": "Morning", "shift": SHIFTS["Morning"], "default": True}
    result = serialize_doc(assignment)
    result["shift"] = SHIFTS.get(result["shift_name"])
    result["default"] = False
    return result
