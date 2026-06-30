from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.database import employees_col, salary_history_col
from app.schemas import EmployeeCreate, EmployeeUpdate, SalaryRevision
from app.security import get_current_user, hash_password, require_admin
from app.utils import active_employee_query, clean_update, employee_identity_query, employee_sort_key, log_audit, serialize_doc, serialize_docs, utc_now


router = APIRouter(prefix="/employees", tags=["employees"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, current_user=Depends(require_admin)):
    now = utc_now()
    employee = payload.model_dump()
    password = employee.pop("password")
    if employee.get("joining_date"):
        employee["joining_date"] = employee["joining_date"].isoformat()
    employee["emp_id"] = str(employee["employee_id"])
    employee.update(
        {
            "password_hash": hash_password(password),
            "deleted": False,
            "created_at": now,
            "updated_at": now,
        }
    )
    try:
        result = employees_col.insert_one(employee)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Employee ID or email already exists.") from exc
    created = serialize_doc(employees_col.find_one({"_id": result.inserted_id}))
    log_audit(current_user, "employee_created", "employee", created.get("employee_id"), {"name": created.get("name")})
    return created


@router.get("")
def list_employees(
    search: str | None = None,
    department: str | None = None,
    include_deleted: bool = False,
    current_user=Depends(require_admin),
):
    query = {"role": {"$ne": "admin"}}
    if not include_deleted:
        query["deleted"] = {"$ne": True}
    if department:
        query["department"] = {"$regex": department, "$options": "i"}
    if search:
        clauses = [
            {"name": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
        ]
        if search.isdigit():
            clauses.append({"employee_id": int(search)})
            clauses.append({"emp_id": search})
        query["$or"] = clauses
    employees = serialize_docs(employees_col.find(query))
    return sorted(employees, key=employee_sort_key)


@router.get("/count")
def employee_count(current_user=Depends(require_admin)):
    return {"count": employees_col.count_documents({"deleted": {"$ne": True}, "role": {"$ne": "admin"}})}


@router.get("/departments/list", dependencies=[Depends(require_admin)])
def departments():
    names = sorted({str(name).strip() for name in employees_col.distinct("department") if str(name).strip()})
    return {"departments": names}


@router.get("/{employee_id}")
def get_employee(employee_id: int, current_user=Depends(get_current_user)):
    current_employee_id = serialize_doc(current_user)["employee_id"]
    if current_user.get("role") != "admin" and current_employee_id != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own profile.")
    employee = employees_col.find_one(active_employee_query(employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return serialize_doc(employee)


@router.patch("/{employee_id}")
def update_employee(employee_id: int, payload: EmployeeUpdate, current_user=Depends(require_admin)):
    updates = clean_update(payload.model_dump())
    if "joining_date" in updates:
        updates["joining_date"] = updates["joining_date"].isoformat()
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update.")
    updates["updated_at"] = utc_now()
    result = employees_col.update_one(
        active_employee_query(employee_id),
        {"$set": updates},
    )
    if not result.matched_count:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    updated = serialize_doc(employees_col.find_one(employee_identity_query(employee_id)))
    log_audit(current_user, "employee_updated", "employee", employee_id, {"fields": sorted(updates.keys())})
    return updated


@router.post("/{employee_id}/salary")
def set_employee_salary(employee_id: int, payload: SalaryRevision, current_user=Depends(require_admin)):
    employee = employees_col.find_one(active_employee_query(employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    current_salary = float(employee.get("basic_salary", employee.get("salary", 0)) or 0)
    new_salary = payload.amount
    if new_salary < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Salary cannot be negative.")
    now = utc_now()
    effective_from = payload.effective_from.isoformat()
    employees_col.update_one(
        {"_id": employee["_id"]},
        {"$set": {"basic_salary": new_salary, "salary": new_salary, "updated_at": now}},
    )
    salary_history_col.insert_one(
        {
            "emp_id": employee_id,
            "employee_id": employee_id,
            "basic_salary": new_salary,
            "previous_salary": current_salary,
            "effective_from": effective_from,
            "note": payload.note,
            "created_at": now,
        }
    )
    updated = serialize_doc(employees_col.find_one(employee_identity_query(employee_id)))
    log_audit(
        current_user,
        "salary_updated",
        "employee",
        employee_id,
        {"previous_salary": current_salary, "new_salary": new_salary, "effective_from": effective_from},
    )
    return updated


@router.delete("/{employee_id}")
def deactivate_employee(employee_id: int, current_user=Depends(require_admin)):
    current_employee_id = serialize_doc(current_user)["employee_id"]
    employee = employees_col.find_one(active_employee_query(employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active employee not found.")
    if employee_id == current_employee_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own admin account.")
    if employee.get("role") == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be deactivated from Delete Employee.")
    result = employees_col.update_one(
        {"_id": employee["_id"]},
        {"$set": {"deleted": True, "deleted_at": utc_now(), "updated_at": utc_now()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active employee not found.")
    log_audit(current_user, "employee_deactivated", "employee", employee_id)
    return {"message": "Employee deactivated successfully."}


@router.post("/{employee_id}/restore")
def restore_employee(employee_id: int, current_user=Depends(require_admin)):
    result = employees_col.update_one(
        {"$and": [{"deleted": True}, employee_identity_query(employee_id)]},
        {"$set": {"deleted": False, "updated_at": utc_now()}, "$unset": {"deleted_at": ""}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deactivated employee not found.")
    log_audit(current_user, "employee_restored", "employee", employee_id)
    return {"message": "Employee restored successfully."}
