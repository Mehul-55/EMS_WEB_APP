from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query

from app.database import (
    attendance_col,
    employees_col,
    holidays_col,
    leave_requests_col,
    salary_col,
    salary_history_col,
    shift_assignments_col,
    sunday_work_approvals_col,
)
from app.routers.shifts import SHIFTS
from app.security import get_current_user, require_admin
from app.utils import serialize_doc, serialize_docs, today_string


router = APIRouter(prefix="/reports", tags=["reports"])


def _number(value, default=0.0):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _number_or(value, fallback=0.0):
    if value is None or value == "":
        return float(fallback or 0)
    return _number(value, fallback)


def _active_employees():
    docs = serialize_docs(employees_col.find({"deleted": {"$ne": True}, "role": {"$ne": "admin"}}))
    return sorted(docs, key=lambda item: str(item.get("employee_id") or item.get("emp_id") or ""))


def _employee_id(doc: dict) -> str:
    return str(doc.get("employee_id") or doc.get("emp_id") or "")


def _date_query(field: str, start: str, end: str):
    return {field: {"$gte": start, "$lte": end}}


def _attendance_for_range(start: str, end: str):
    query = {"$or": [_date_query("work_date", start, end), _date_query("date", start, end)]}
    return serialize_docs(attendance_col.find(query))


def _month_dates(start: str, end: str) -> list[str]:
    current = date.fromisoformat(start)
    last = date.fromisoformat(end)
    dates = []
    while current <= last:
        dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


def _status_key(value: str | None) -> str:
    return str(value or "").strip().lower().replace("-", " ")


def _count_days(records: list[dict], *statuses: str) -> float:
    wanted = {_status_key(status) for status in statuses}
    return sum(1 for record in records if _status_key(record.get("status")) in wanted)


def _records_by_date(records: list[dict]) -> list[dict]:
    by_date = {}
    for record in records:
        work_date = str(record.get("work_date") or record.get("date") or "")[:10]
        if work_date:
            by_date[work_date] = record
    return list(by_date.values())


def _sum_number(records: list[dict], *fields: str) -> float:
    total = 0.0
    for record in records:
        for field in fields:
            if record.get(field) is not None:
                total += _number(record.get(field))
                break
    return round(total, 2)


def _saved_salary_docs(prefix: str) -> dict[str, dict]:
    query = {
        "$or": [
            {"month": prefix},
            {"salary_month": prefix},
            {"period_start": {"$regex": f"^{prefix}"}},
            {"date": {"$regex": f"^{prefix}"}},
        ]
    }
    docs = serialize_docs(salary_col.find(query).sort("saved_at", -1))
    by_emp = {}
    for doc in docs:
        emp_id = _employee_id(doc)
        if emp_id:
            by_emp.setdefault(emp_id, doc)
    return by_emp


def _salary_history_for_range(employee_ids: list[int], end: str) -> dict[str, list[dict]]:
    docs = serialize_docs(
        salary_history_col.find(
            {"emp_id": {"$in": employee_ids}, "effective_from": {"$lte": end}},
            sort=[("emp_id", 1), ("effective_from", -1), ("created_at", -1)],
        )
    )
    by_emp = {}
    for doc in docs:
        by_emp.setdefault(str(doc.get("emp_id")), []).append(doc)
    return by_emp


def _basic_salary_for_period(employee: dict, history: list[dict], end: str) -> float:
    for entry in history:
        if str(entry.get("effective_from") or "") <= end:
            return _number(entry.get("basic_salary"))
    return _number(employee.get("basic_salary", employee.get("salary")))


def _holiday_dates(start: str, end: str) -> set[str]:
    docs = serialize_docs(
        holidays_col.find(
            {
                "$or": [
                    _date_query("date", start, end),
                    _date_query("holiday_date", start, end),
                    _date_query("_holiday_date", start, end),
                ]
            }
        )
    )
    dates = set()
    for doc in docs:
        value = doc.get("_holiday_date") or doc.get("holiday_date") or doc.get("date")
        if value:
            dates.add(str(value)[:10])
    return dates


def _leave_dates_by_employee(employee_ids: list[int], start: str, end: str) -> dict[str, dict[str, float]]:
    query = {
        "$or": [{"emp_id": {"$in": employee_ids}}, {"employee_id": {"$in": employee_ids}}],
        "status": {"$in": ["Approved", "Revert Requested"]},
        "$and": [{"from_date": {"$lte": end}}, {"to_date": {"$gte": start}}],
    }
    leave_map: dict[str, dict[str, float]] = {}
    for leave in serialize_docs(leave_requests_col.find(query)):
        emp_id = _employee_id(leave)
        if not emp_id:
            continue
        duration = str(leave.get("leave_duration") or leave.get("duration") or "Full Day").lower()
        day_value = 0.25 if "quarter" in duration else 0.5 if "half" in duration else 1.0
        dates = leave.get("working_dates") or []
        if not dates:
            dates = [
                day
                for day in _month_dates(max(str(leave.get("from_date"))[:10], start), min(str(leave.get("to_date"))[:10], end))
            ]
        for leave_date in dates:
            leave_date = str(leave_date)[:10]
            if start <= leave_date <= end:
                leave_map.setdefault(emp_id, {})[leave_date] = max(leave_map.setdefault(emp_id, {}).get(leave_date, 0), day_value)
    return leave_map


def _salary_row_from_doc(doc: dict, employee: dict | None = None) -> dict:
    employee = employee or {}
    emp_id = _employee_id(doc) or _employee_id(employee)
    paid = _number_or(doc.get("paid_leave_days", doc.get("paid_leaves", doc.get("paid_days"))))
    unpaid = _number_or(doc.get("unpaid_leave_days", doc.get("unpaid_leaves", doc.get("unpaid_days"))))
    return {
        "employee_id": int(emp_id) if str(emp_id).isdigit() else emp_id,
        "name": doc.get("name") or employee.get("name") or "N/A",
        "department": doc.get("department") or employee.get("department") or "N/A",
        "shift": doc.get("shift") or employee.get("shift") or employee.get("shift_name") or "N/A",
        "has_basic_salary": bool(doc.get("has_basic_salary", _number(doc.get("basic_salary")) > 0)),
        "basic_salary": _number(doc.get("basic_salary", employee.get("basic_salary"))),
        "gross_salary": _number(doc.get("gross_salary", doc.get("basic_salary"))),
        "attendance_deductions": _number(doc.get("attendance_deductions", doc.get("total_deductions"))),
        "total_deductions": _number(doc.get("total_deductions", doc.get("attendance_deductions"))),
        "payroll_days": _number(doc.get("payroll_days")),
        "working_days": _number(doc.get("working_days")),
        "days_present": _number(doc.get("days_present")),
        "days_absent": _number(doc.get("days_absent")),
        "days_halfday": _number(doc.get("days_halfday")),
        "paid_holidays": _number(doc.get("paid_holidays")),
        "missed_checkouts": _number(doc.get("missed_checkouts")),
        "total_late_hours": _number(doc.get("total_late_hours")),
        "late_deduction": _number(doc.get("late_deduction")),
        "early_exit_deduction": _number(doc.get("early_exit_deduction")),
        "absent_deduction": _number(doc.get("absent_deduction")),
        "halfday_deduction": _number(doc.get("halfday_deduction")),
        "total_ot_hours": _number(doc.get("total_ot_hours")),
        "ot_pay": _number(doc.get("ot_pay")),
        "net_salary": _number(doc.get("net_salary", doc.get("salary"))),
        "paid_leaves": paid,
        "unpaid_leaves": unpaid,
        "paid_leave_days": paid,
        "unpaid_leave_days": unpaid,
        "source": "saved",
    }


@router.get("/salary", dependencies=[Depends(require_admin)])
def salary_report(month: int | None = None, year: int | None = None):
    employees = _active_employees()
    now = date.fromisoformat(today_string())
    selected_month = month or now.month
    selected_year = year or now.year
    prefix = f"{selected_year:04d}-{selected_month:02d}"
    start = f"{selected_year:04d}-{selected_month:02d}-01"
    end = f"{selected_year:04d}-{selected_month:02d}-{monthrange(selected_year, selected_month)[1]:02d}"
    payroll_days = monthrange(selected_year, selected_month)[1]
    all_dates = _month_dates(start, end)
    holiday_dates = _holiday_dates(start, end)
    sunday_dates = {day for day in all_dates if date.fromisoformat(day).weekday() == 6}
    paid_holiday_dates = holiday_dates | sunday_dates
    employee_ids = [int(_employee_id(employee)) for employee in employees if _employee_id(employee).isdigit()]
    employees_by_id = {_employee_id(employee): employee for employee in employees}
    saved_salary_docs = _saved_salary_docs(prefix)
    salary_history_by_emp = _salary_history_for_range(employee_ids, end)
    leave_dates_by_emp = _leave_dates_by_employee(employee_ids, start, end)
    attendance_by_emp = {}
    for record in _attendance_for_range(start, end):
        attendance_by_emp.setdefault(_employee_id(record), []).append(record)

    rows = []
    totals = {
        "basic_salary": 0.0,
        "gross_salary": 0.0,
        "attendance_deductions": 0.0,
        "total_deductions": 0.0,
        "ot_pay": 0.0,
        "net_salary": 0.0,
        "paid_leaves": 0.0,
        "unpaid_leaves": 0.0,
    }
    handled_saved_ids = set()
    for emp_id, saved_doc in saved_salary_docs.items():
        row = _salary_row_from_doc(saved_doc, employees_by_id.get(emp_id))
        handled_saved_ids.add(emp_id)
        rows.append(row)
        totals["basic_salary"] += row["basic_salary"]
        totals["gross_salary"] += row["gross_salary"]
        totals["attendance_deductions"] += row["attendance_deductions"]
        totals["total_deductions"] += row["total_deductions"]
        totals["ot_pay"] += row["ot_pay"]
        totals["net_salary"] += row["net_salary"]
        totals["paid_leaves"] += row["paid_leaves"]
        totals["unpaid_leaves"] += row["unpaid_leaves"]

    for employee in employees:
        emp_id = _employee_id(employee)
        if emp_id in handled_saved_ids:
            continue
        emp_records = attendance_by_emp.get(emp_id, [])
        leave_dates = leave_dates_by_emp.get(emp_id, {})
        recorded_dates = {str(record.get("work_date") or record.get("date") or "")[:10] for record in emp_records}
        paid = round(sum(leave_dates.values()), 2)
        working_dates = [
            day
            for day in all_dates
            if day not in paid_holiday_dates and day not in leave_dates
        ]
        cutoff = min(end, today_string()) if prefix == today_string()[:7] else end
        expected_marked_dates = [day for day in working_dates if day <= cutoff]
        basic = _basic_salary_for_period(employee, salary_history_by_emp.get(emp_id, []), end)
        days_present = _count_days(emp_records, "Present")
        days_halfday = _count_days(emp_records, "Half Day", "Half-Day")
        explicit_absent = _count_days(emp_records, "Absent")
        missing_absent = sum(1 for day in expected_marked_dates if day not in recorded_dates)
        days_absent = explicit_absent + missing_absent
        missed_checkouts = sum(
            1
            for record in emp_records
            if (record.get("check_in") or record.get("arrival_time")) and not (record.get("check_out") or record.get("checkout_time"))
        )
        total_late_hours = _sum_number(emp_records, "late_hours") or round(_sum_number(emp_records, "late_minutes") / 60, 2)
        total_ot_hours = _sum_number(emp_records, "overtime_hours", "ot_hours")
        paid_holidays = len(paid_holiday_dates)
        working_days = max(payroll_days - paid_holidays, 0)
        effective_days = working_days if working_days else payroll_days
        unpaid = 0.0
        per_day = basic / effective_days if effective_days and basic else 0
        per_hour = per_day / 8 if per_day else 0
        absent_deduction = days_absent * per_day
        halfday_deduction = days_halfday * per_day * 0.5
        late_deduction = total_late_hours * per_hour
        early_exit_deduction = _sum_number(emp_records, "early_exit_hours") * per_hour
        attendance_deductions = absent_deduction + halfday_deduction + late_deduction + early_exit_deduction
        total_deductions = attendance_deductions
        ot_pay = total_ot_hours * per_hour * 1.5
        gross = basic + ot_pay
        net = gross - total_deductions
        totals["basic_salary"] += basic
        totals["gross_salary"] += gross
        totals["attendance_deductions"] += attendance_deductions
        totals["total_deductions"] += total_deductions
        totals["ot_pay"] += ot_pay
        totals["net_salary"] += net
        totals["paid_leaves"] += paid
        totals["unpaid_leaves"] += unpaid
        rows.append(
            {
                "employee_id": int(emp_id) if emp_id.isdigit() else emp_id,
                "name": employee.get("name"),
                "department": employee.get("department") or "N/A",
                "shift": employee.get("shift") or employee.get("shift_name") or "N/A",
                "has_basic_salary": basic > 0,
                "basic_salary": round(basic, 2),
                "gross_salary": round(gross, 2),
                "attendance_deductions": round(attendance_deductions, 2),
                "total_deductions": round(total_deductions, 2),
                "payroll_days": payroll_days,
                "working_days": working_days,
                "days_present": round(days_present, 2),
                "days_absent": round(days_absent, 2),
                "days_halfday": round(days_halfday, 2),
                "paid_holidays": paid_holidays,
                "missed_checkouts": missed_checkouts,
                "total_late_hours": round(total_late_hours, 2),
                "late_deduction": round(late_deduction, 2),
                "early_exit_deduction": round(early_exit_deduction, 2),
                "absent_deduction": round(absent_deduction, 2),
                "halfday_deduction": round(halfday_deduction, 2),
                "total_ot_hours": round(total_ot_hours, 2),
                "ot_pay": round(ot_pay, 2),
                "net_salary": round(net, 2),
                "paid_leaves": paid,
                "unpaid_leaves": unpaid,
                "paid_leave_days": paid,
                "unpaid_leave_days": unpaid,
                "source": "calculated",
            }
        )
    rows.sort(key=lambda row: int(row["employee_id"]) if str(row.get("employee_id")).isdigit() else str(row.get("employee_id")))
    totals = {key: round(value, 2) for key, value in totals.items()}
    return {"month": selected_month, "year": selected_year, "rows": rows, "totals": totals}


@router.get("/monthly-attendance")
def monthly_attendance(
    month: int = Query(ge=1, le=12),
    year: int = Query(ge=2000),
    current_user=Depends(get_current_user),
):
    start = f"{year:04d}-{month:02d}-01"
    end = f"{year:04d}-{month:02d}-{monthrange(year, month)[1]:02d}"
    cutoff = min(end, today_string()) if f"{year:04d}-{month:02d}" == today_string()[:7] else end
    paid_holiday_dates = _holiday_dates(start, end) | {
        day for day in _month_dates(start, end) if date.fromisoformat(day).weekday() == 6
    }
    expected_working_days = sum(
        1 for day in _month_dates(start, cutoff) if day not in paid_holiday_dates
    )
    employees = _active_employees()
    if current_user.get("role") != "admin":
        current_id = str(serialize_doc(current_user)["employee_id"])
        employees = [employee for employee in employees if _employee_id(employee) == current_id]

    records = _attendance_for_range(start, end)
    by_emp = {}
    for record in records:
        by_emp.setdefault(_employee_id(record), []).append(record)

    rows = []
    for employee in employees:
        emp_records = _records_by_date(by_emp.get(_employee_id(employee), []))
        present = _count_days(emp_records, "Present")
        absent = _count_days(emp_records, "Absent")
        leave = _count_days(emp_records, "Leave")
        half_day = _count_days(emp_records, "Half Day", "Half-Day")
        total_marked = len(emp_records)
        attended_days = present + (half_day * 0.5)
        rows.append(
            {
                "employee_id": employee.get("employee_id") or employee.get("emp_id"),
                "name": employee.get("name"),
                "department": employee.get("department") or "N/A",
                "present": present,
                "absent": absent,
                "half_day": half_day,
                "leave": leave,
                "total_marked": total_marked,
                "expected_working_days": expected_working_days,
                "attendance_percentage": round((attended_days / expected_working_days) * 100, 2) if expected_working_days else 0,
            }
        )
    return {"month": month, "year": year, "rows": rows}


@router.get("/daily-attendance", dependencies=[Depends(require_admin)])
def daily_attendance(work_date: date | None = None):
    selected = work_date.isoformat() if work_date else today_string()
    employees = _active_employees()
    records = serialize_docs(attendance_col.find({"$or": [{"work_date": selected}, {"date": selected}]}))
    by_emp = {_employee_id(record): record for record in records}
    rows = []
    for employee in employees:
        record = by_emp.get(_employee_id(employee), {})
        rows.append(
            {
                "employee_id": employee.get("employee_id") or employee.get("emp_id"),
                "name": employee.get("name"),
                "department": employee.get("department") or "N/A",
                "shift": record.get("shift") or record.get("shift_name") or "N/A",
                "status": record.get("status") or "Not Marked",
                "check_in": record.get("check_in") or record.get("arrival_time") or "-",
                "check_out": record.get("check_out") or record.get("checkout_time") or "-",
                "hours_worked": record.get("hours_worked") or 0,
                "late_hours": record.get("late_hours") or 0,
                "overtime_hours": record.get("overtime_hours") or 0,
                "marked_by": record.get("marked_by") or "-",
            }
        )
    return {"date": selected, "rows": rows}


@router.get("/shift-management", dependencies=[Depends(require_admin)])
def shift_management():
    employees = _active_employees()
    employee_ids = [int(_employee_id(employee)) for employee in employees if _employee_id(employee).isdigit()]
    assignment_docs = serialize_docs(
        shift_assignments_col.find(
            {"$or": [{"employee_id": {"$in": employee_ids}}, {"emp_id": {"$in": [str(emp_id) for emp_id in employee_ids]}}]},
            sort=[("employee_id", 1), ("effective_from", -1), ("created_at", -1)],
        )
    )
    latest_by_emp = {}
    for assignment in assignment_docs:
        emp_id = _employee_id(assignment)
        if emp_id and emp_id not in latest_by_emp:
            latest_by_emp[emp_id] = assignment

    assignments = []
    for employee in employees:
        emp_id = _employee_id(employee)
        assignment = latest_by_emp.get(emp_id, {})
        shift_name = assignment.get("shift_name") or employee.get("shift_name") or employee.get("shift") or "Morning"
        shift = SHIFTS.get(shift_name, SHIFTS["Morning"])
        assignments.append(
            {
                "employee_id": employee.get("employee_id") or employee.get("emp_id"),
                "name": employee.get("name"),
                "department": employee.get("department") or "N/A",
                "shift_name": shift_name,
                "shift_hours": f"{shift['hours']} hrs ({shift['start']} to {shift['end']})",
                "effective_from": assignment.get("effective_from") or "-",
            }
        )

    sunday_work = serialize_docs(sunday_work_approvals_col.find({"active": True}, sort=[("date", -1), ("emp_id", 1)]))
    return {
        "shifts": [{"name": name, **details} for name, details in SHIFTS.items()],
        "assignments": sorted(assignments, key=lambda item: int(item["employee_id"]) if str(item.get("employee_id")).isdigit() else str(item.get("employee_id"))),
        "sunday_work": sunday_work,
    }
