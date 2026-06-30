from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.config import get_settings


settings = get_settings()
client = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=3000)
db = client[settings.mongo_db_name]

employees_col = db["employees"]
attendance_col = db["attendance"]
shift_assignments_col = db["shift_assignments"]
sunday_work_approvals_col = db["sunday_work_approvals"]
leave_requests_col = db["leave_requests"]
leaves_col = db["leaves"]
salary_col = db["salary"]
salary_history_col = db["salary_history"]
shifts_col = db["shifts"]
holidays_col = db["holidays"]
audit_logs_col = db["audit_logs"]


def init_indexes() -> None:
    _create_index(employees_col, "employee_id", unique=True, sparse=True)
    _create_index(employees_col, "emp_id", unique=True, sparse=True)
    _create_index(employees_col, "email", unique=True, sparse=True)
    _create_index(attendance_col, [("employee_id", ASCENDING), ("work_date", ASCENDING)], unique=True, sparse=True)
    _create_index(attendance_col, [("emp_id", ASCENDING), ("date", ASCENDING)], sparse=True)
    _create_index(shift_assignments_col, [("employee_id", ASCENDING), ("effective_from", ASCENDING)])
    _create_index(shift_assignments_col, [("emp_id", ASCENDING), ("effective_from", ASCENDING)])
    _create_index(sunday_work_approvals_col, [("emp_id", ASCENDING), ("date", ASCENDING)], unique=True, sparse=True)
    _create_index(leave_requests_col, [("employee_id", ASCENDING), ("from_date", ASCENDING), ("to_date", ASCENDING)])
    _create_index(leave_requests_col, [("emp_id", ASCENDING), ("from_date", ASCENDING), ("to_date", ASCENDING)])
    _create_index(audit_logs_col, [("created_at", ASCENDING)])
    _create_index(audit_logs_col, [("actor_employee_id", ASCENDING), ("created_at", ASCENDING)])
    _create_index(audit_logs_col, [("entity_type", ASCENDING), ("created_at", ASCENDING)])


def _create_index(collection, keys, **kwargs) -> None:
    try:
        collection.create_index(keys, **kwargs)
    except DuplicateKeyError:
        return
    except OperationFailure as exc:
        if exc.code != 86:
            raise


def ping_database() -> bool:
    client.admin.command("ping")
    return True
