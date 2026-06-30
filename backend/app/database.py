import certifi
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.config import get_settings


_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = MongoClient(
            settings.mongo_uri,
            serverSelectionTimeoutMS=3000,
            tlsCAFile=certifi.where(),
        )
    return _client


def get_db():
    settings = get_settings()
    return get_client()[settings.mongo_db_name]


class LazyCollection:
    def __init__(self, name: str):
        self.name = name

    def _collection(self):
        return get_db()[self.name]

    def __getattr__(self, item):
        return getattr(self._collection(), item)

    def __getitem__(self, item):
        return self._collection()[item]


employees_col = LazyCollection("employees")
attendance_col = LazyCollection("attendance")
shift_assignments_col = LazyCollection("shift_assignments")
sunday_work_approvals_col = LazyCollection("sunday_work_approvals")
leave_requests_col = LazyCollection("leave_requests")
leaves_col = LazyCollection("leaves")
salary_col = LazyCollection("salary")
salary_history_col = LazyCollection("salary_history")
shifts_col = LazyCollection("shifts")
holidays_col = LazyCollection("holidays")
audit_logs_col = LazyCollection("audit_logs")


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
    get_client().admin.command("ping")
    return True
