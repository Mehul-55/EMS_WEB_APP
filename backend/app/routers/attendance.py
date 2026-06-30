from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import attendance_col, employees_col
from app.schemas import AttendanceCheckIn, AttendanceCheckOut, AttendanceManualMark
from app.security import get_current_user, require_admin
from app.utils import active_employee_query, employee_identity_query, employee_sort_key, local_time_string, log_audit, serialize_doc, serialize_docs, today_string, utc_now


router = APIRouter(prefix="/attendance", tags=["attendance"])


def _employee_id_for_action(requested_employee_id: int | None, current_user: dict) -> int:
    current_employee_id = serialize_doc(current_user)["employee_id"]
    if current_user.get("role") == "admin":
        return requested_employee_id or current_employee_id
    if requested_employee_id and requested_employee_id != current_employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only manage your own attendance.")
    return current_employee_id


def _active_employee_or_404(employee_id: int) -> dict:
    employee = employees_col.find_one(active_employee_query(employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return employee


def _hours_between(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    try:
        start_time = datetime.strptime(start, "%H:%M")
        end_time = datetime.strptime(end, "%H:%M")
    except ValueError:
        return None
    if end_time < start_time:
        end_time += timedelta(days=1)
    return round((end_time - start_time).total_seconds() / 3600, 2)


@router.post("/check-in")
def check_in(payload: AttendanceCheckIn, current_user=Depends(get_current_user)):
    employee_id = _employee_id_for_action(payload.employee_id, current_user)
    _active_employee_or_404(employee_id)
    now = utc_now()
    work_date = today_string()
    identity = employee_identity_query(employee_id)
    existing = attendance_col.find_one({"$and": [identity, {"$or": [{"work_date": work_date}, {"date": work_date}]}]})
    existing_normalized = serialize_doc(existing) if existing else None
    if existing_normalized and existing_normalized.get("check_in"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already checked in for today.")

    attendance_col.update_one(
        {"employee_id": employee_id, "work_date": work_date},
        {
            "$setOnInsert": {
                "employee_id": employee_id,
                "emp_id": str(employee_id),
                "work_date": work_date,
                "date": work_date,
                "created_at": now,
            },
            "$set": {
                "check_in": now,
                "arrival_time": local_time_string(now),
                "status": "Present",
                "updated_at": now,
            },
        },
        upsert=True,
    )
    record = serialize_doc(attendance_col.find_one({"employee_id": employee_id, "work_date": work_date}))
    log_audit(current_user, "attendance_check_in", "attendance", record.get("id"), {"employee_id": employee_id, "work_date": work_date})
    return record


@router.post("/check-out")
def check_out(payload: AttendanceCheckOut, current_user=Depends(get_current_user)):
    employee_id = _employee_id_for_action(payload.employee_id, current_user)
    work_date = today_string()
    now = utc_now()
    record = attendance_col.find_one({"$and": [employee_identity_query(employee_id), {"$or": [{"work_date": work_date}, {"date": work_date}]}]})
    normalized = serialize_doc(record) if record else None
    if not normalized or not normalized.get("check_in"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Check in before checking out.")
    if normalized.get("check_out"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already checked out for today.")

    attendance_col.update_one(
        {"_id": record["_id"]},
        {"$set": {"check_out": now, "checkout_time": local_time_string(now), "updated_at": now}},
    )
    updated = serialize_doc(attendance_col.find_one({"_id": record["_id"]}))
    log_audit(current_user, "attendance_check_out", "attendance", updated.get("id"), {"employee_id": employee_id, "work_date": work_date})
    return updated


@router.get("/today")
def today(current_user=Depends(get_current_user)):
    query = {"$or": [{"work_date": today_string()}, {"date": today_string()}]}
    if current_user.get("role") != "admin":
        query = {"$and": [query, employee_identity_query(serialize_doc(current_user)["employee_id"])]}
    rows = serialize_docs(attendance_col.find(query))
    return sorted(rows, key=employee_sort_key)


@router.get("")
def list_attendance(
    employee_id: int | None = None,
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    current_user=Depends(get_current_user),
):
    query = {}
    if current_user.get("role") != "admin":
        query = employee_identity_query(serialize_doc(current_user)["employee_id"])
    elif employee_id:
        query = employee_identity_query(employee_id)
    if from_date or to_date:
        date_query = {}
        if from_date:
            date_query["$gte"] = from_date.isoformat()
        if to_date:
            date_query["$lte"] = to_date.isoformat()
        date_filter = {"$or": [{"work_date": date_query}, {"date": date_query}]}
        query = {"$and": [query, date_filter]} if query else date_filter
    rows = serialize_docs(attendance_col.find(query))
    return sorted(rows, key=lambda item: (str(item.get("work_date") or item.get("date") or ""), employee_sort_key(item)))


@router.put("/manual")
def manual_mark(payload: AttendanceManualMark, current_user=Depends(require_admin)):
    _active_employee_or_404(payload.employee_id)
    now = utc_now()
    update = {
        "employee_id": payload.employee_id,
        "emp_id": str(payload.employee_id),
        "work_date": payload.work_date.isoformat(),
        "date": payload.work_date.isoformat(),
        "status": payload.status,
        "note": payload.note,
        "updated_at": now,
    }
    if payload.check_in:
        update["check_in"] = payload.check_in
        update["arrival_time"] = payload.check_in
    if payload.check_out:
        update["check_out"] = payload.check_out
        update["checkout_time"] = payload.check_out
    hours_worked = _hours_between(payload.check_in, payload.check_out)
    if hours_worked is not None:
        update["hours_worked"] = hours_worked
    unset = {}
    if not payload.check_in:
        unset.update({"check_in": "", "arrival_time": ""})
    if not payload.check_out:
        unset.update({"check_out": "", "checkout_time": ""})
    if hours_worked is None:
        unset["hours_worked"] = ""
    operation = {"$set": update, "$setOnInsert": {"created_at": now}}
    if unset:
        operation["$unset"] = unset
    attendance_col.update_one(
        {"employee_id": payload.employee_id, "work_date": payload.work_date.isoformat()},
        operation,
        upsert=True,
    )
    record = serialize_doc(attendance_col.find_one({"employee_id": payload.employee_id, "work_date": payload.work_date.isoformat()}))
    log_audit(
        current_user,
        "attendance_manual_marked",
        "attendance",
        record.get("id"),
        {"employee_id": payload.employee_id, "work_date": payload.work_date.isoformat(), "status": payload.status},
    )
    return record


@router.get("/summary", dependencies=[Depends(require_admin)])
def summary(from_date: date | None = None, to_date: date | None = None):
    start = from_date.isoformat() if from_date else None
    end = to_date.isoformat() if to_date else start
    match = {}
    if start or end:
        date_query = {}
        if start:
            date_query["$gte"] = start
        if end:
            date_query["$lte"] = end
        match = {"$or": [{"work_date": date_query}, {"date": date_query}]}
    rows = serialize_docs(attendance_col.find(match))

    summary_counts = {}
    seen_employee_dates = set()
    for row in rows:
        employee_id = str(row.get("employee_id") or row.get("emp_id") or "").strip()
        work_date = str(row.get("work_date") or row.get("date") or "")[:10]
        key = (employee_id, work_date)
        if employee_id and work_date and key in seen_employee_dates:
            continue
        if employee_id and work_date:
            seen_employee_dates.add(key)
        status_label = _display_status(row.get("status"))
        summary_counts[status_label] = summary_counts.get(status_label, 0) + 1

    if start and end and start == end:
        marked_employee_ids = {employee_id for employee_id, _ in seen_employee_dates if employee_id}
        active_count = employees_col.count_documents({"deleted": {"$ne": True}, "role": {"$ne": "admin"}})
        missing_count = max(active_count - len(marked_employee_ids), 0)
        if missing_count:
            summary_counts["Absent"] = summary_counts.get("Absent", 0) + missing_count

    return {"summary": dict(sorted(summary_counts.items()))}


def _display_status(value: str | None) -> str:
    normalized = str(value or "Unknown").strip().lower().replace("-", " ")
    labels = {
        "present": "Present",
        "absent": "Absent",
        "half day": "Half Day",
        "leave": "Leave",
        "holiday": "Holiday",
    }
    return labels.get(normalized, str(value or "Unknown").strip() or "Unknown")
