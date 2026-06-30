from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


Role = Literal["admin", "employee"]
AttendanceStatus = Literal["Present", "Absent", "Half Day", "Leave", "Holiday"]
LeaveStatus = Literal["Pending", "Approved", "Rejected", "Cancelled", "Revert Requested"]
ShiftName = Literal["Morning", "Evening", "Night"]


class LoginRequest(BaseModel):
    employee_id: int | None = None
    username: str | None = None
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class EmployeeCreate(BaseModel):
    employee_id: int = Field(gt=0)
    name: str = Field(min_length=1)
    department: str = Field(min_length=1)
    basic_salary: float = Field(ge=0)
    password: str = Field(min_length=6)
    role: Role = "employee"
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    joining_date: date | None = None


class EmployeeUpdate(BaseModel):
    name: str | None = None
    department: str | None = None
    basic_salary: float | None = Field(default=None, ge=0)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    joining_date: date | None = None


class SalaryRevision(BaseModel):
    amount: float
    effective_from: date
    note: str | None = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6)


class ProfileUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    profile_photo: str | None = None


class AttendanceCheckIn(BaseModel):
    employee_id: int | None = None


class AttendanceCheckOut(BaseModel):
    employee_id: int | None = None


class AttendanceManualMark(BaseModel):
    employee_id: int
    work_date: date
    status: AttendanceStatus
    check_in: str | None = None
    check_out: str | None = None
    note: str | None = None


class ShiftAssignment(BaseModel):
    employee_id: int
    shift_name: ShiftName
    effective_from: date | None = None


class SundayWorkApproval(BaseModel):
    employee_id: int
    work_date: date
    reason: str = Field(min_length=1)


class LeaveRequestCreate(BaseModel):
    leave_type: str = Field(min_length=1)
    from_date: date
    to_date: date
    reason: str = Field(min_length=1)
    duration: Literal["Full Day", "Half Day", "Quarter Leave"] = "Full Day"


class LeaveReview(BaseModel):
    status: Literal["Approved", "Rejected", "Cancelled"]
    remarks: str | None = None


class LeaveRevertRequest(BaseModel):
    reason: str = Field(min_length=1)
