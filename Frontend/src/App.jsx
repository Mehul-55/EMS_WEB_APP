import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import "./App.css";

const API_BASE = normalizeLocalApiBase(import.meta.env.VITE_API_BASE_URL || "http://localhost:8000");

function normalizeLocalApiBase(configuredBase) {
  if (typeof window === "undefined") return configuredBase;
  try {
    const apiUrl = new URL(configuredBase);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    if (localHosts.has(apiUrl.hostname) && localHosts.has(window.location.hostname)) {
      apiUrl.hostname = window.location.hostname;
    }
    return apiUrl.origin;
  } catch {
    return configuredBase;
  }
}

const adminNavItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "employees", label: "All Employees", icon: Users },
  { id: "add_edit", label: "Add / Edit", icon: Plus },
  { id: "delete", label: "Delete Employee", icon: Trash2 },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "leaves", label: "Manage Leaves", icon: BriefcaseBusiness },
  { id: "leave_requests", label: "Leave Requests", icon: ShieldCheck },
  { id: "salary_report", label: "Salary Report", icon: WalletCards },
  { id: "monthly_attendance", label: "Monthly Attendance", icon: ScrollText },
  { id: "daily_report", label: "Daily Report", icon: Clock3 },
  { id: "audit_logs", label: "Audit Logs", icon: ScrollText },
  { id: "shifts", label: "Shift Management", icon: CalendarClock },
];

const employeeNavItems = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "attendance", label: "My Attendance", icon: CalendarCheck },
  { id: "monthly_report", label: "Monthly Report", icon: ScrollText },
  { id: "my_leaves", label: "My Leaves", icon: BriefcaseBusiness },
  { id: "request_leave", label: "Request Leave", icon: Plus },
];

const emptyEmployee = {
  employee_id: "",
  name: "",
  department: "",
  basic_salary: "",
  email: "",
  phone: "",
  password: "",
  role: "employee",
};

const emptyLeave = {
  leave_type: "Casual Leave",
  from_date: "",
  to_date: "",
  duration: "Full Day",
  reason: "",
};

const emptyManualAttendance = {
  employee_id: "",
  work_date: localDateISO(),
  status: "Present",
  check_in: "",
  check_out: "",
  note: "",
};

const emptyLeaveBalance = {
  employee_id: "",
  total_leaves: "",
};

const emptySalaryRevision = {
  employee_id: "",
  amount: "",
  effective_from: localDateISO(),
  note: "",
};

const emptyShiftAssignment = {
  employee_id: "",
  shift_name: "Morning",
  effective_from: localDateISO(),
};

const emptySundayWork = {
  employee_id: "",
  work_date: localDateISO(),
  reason: "",
};

const emptyPasswordReset = {
  old_password: "",
  new_password: "",
  confirm_password: "",
};

function App() {
  const [user, setUser] = useState(readStoredUser);
  const [token, setToken] = useState(() => (readStoredUser() ? "cookie" : ""));
  const [view, setView] = useState("dashboard");
  const [employees, setEmployees] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [shifts, setShifts] = useState({});
  const [summary, setSummary] = useState({});
  const [auditLogs, setAuditLogs] = useState({ rows: [], page: 1, page_size: 10, total: 0, total_pages: 1 });
  const [auditLogPage, setAuditLogPage] = useState(1);
  const [reports, setReports] = useState({
    salary: null,
    monthly: null,
    daily: null,
    shiftManagement: null,
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [leaveForm, setLeaveForm] = useState(emptyLeave);
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [manualAttendanceForm, setManualAttendanceForm] = useState(emptyManualAttendance);
  const [attendanceFilter, setAttendanceFilter] = useState("All");
  const [leaveBalanceForm, setLeaveBalanceForm] = useState(emptyLeaveBalance);
  const [leaveBalanceFilter, setLeaveBalanceFilter] = useState("All");
  const [salaryRevisionForm, setSalaryRevisionForm] = useState(emptySalaryRevision);
  const [shiftAssignmentForm, setShiftAssignmentForm] = useState(emptyShiftAssignment);
  const [sundayWorkForm, setSundayWorkForm] = useState(emptySundayWork);
  const [passwordResetForm, setPasswordResetForm] = useState(emptyPasswordReset);
  const [deleteEmployeeId, setDeleteEmployeeId] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const isAdmin = user?.role === "admin";
  const navItems = isAdmin ? adminNavItems : employeeNavItems;

  const clearSession = useCallback(() => {
    localStorage.removeItem("ems_token");
    localStorage.removeItem("ems_user");
    setToken("");
    setUser(null);
    setView("dashboard");
  }, []);

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
      }
      throw new Error(data.detail || "Request failed.");
    }
    return data;
  }, [clearSession]);

  const refreshData = useCallback(async (throwOnError = false) => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      const requests = [
        isAdmin
          ? api(`/api/v1/employees${includeDeactivated ? "?include_deleted=true" : ""}`)
          : api(`/api/v1/employees/${user.employee_id}`),
        api("/api/v1/attendance/today"),
        api("/api/v1/leaves"),
        api("/api/v1/shifts"),
      ];
      if (isAdmin) {
        const today = localDateISO();
        const selectedDate = manualAttendanceForm.work_date || today;
        requests.push(api(`/api/v1/attendance/summary?from_date=${today}&to_date=${today}`));
        requests.push(api(`/api/v1/attendance?from_date=${selectedDate}&to_date=${selectedDate}`));
      }
      const [employeeData, attendanceData, leaveData, shiftData, summaryData, selectedAttendanceData] =
        await Promise.all(requests);
      setEmployees(Array.isArray(employeeData) ? employeeData : [employeeData]);
      setTodayAttendance(attendanceData);
      setAttendanceRecords(isAdmin ? selectedAttendanceData || [] : attendanceData);
      setLeaves(leaveData);
      setShifts(shiftData.shifts || {});
      setSummary(summaryData?.summary || {});
    } catch (error) {
      setNotice(error.message);
      if (throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  }, [api, includeDeactivated, isAdmin, manualAttendanceForm.work_date, token, user?.employee_id]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const loadLeaveBalances = useCallback(async (throwOnError = false) => {
    if (!token || !isAdmin) return;
    setLoading(true);
    setNotice("");
    try {
      const data = await api("/api/v1/leaves/balances");
      setLeaveBalances(data.rows || []);
    } catch (error) {
      setNotice(error.message);
      if (throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin, token]);

  const loadAuditLogs = useCallback(async (page = auditLogPage, throwOnError = false) => {
    if (!token || !isAdmin) return;
    setLoading(true);
    setNotice("");
    try {
      const data = await api(`/api/v1/audit-logs?page=${page}&page_size=10`);
      setAuditLogs(data);
      setAuditLogPage(data.page || page);
    } catch (error) {
      setNotice(error.message);
      if (throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  }, [api, auditLogPage, isAdmin, token]);

  useEffect(() => {
    if (token && user?.role === "employee" && view === "dashboard") {
      setView("profile");
    }
  }, [token, user?.role, view]);

  useEffect(() => {
    if (view === "leaves") loadLeaveBalances();
  }, [loadLeaveBalances, view]);

  useEffect(() => {
    if (view === "audit_logs") loadAuditLogs(auditLogPage);
  }, [auditLogPage, loadAuditLogs, view]);

  const loadReport = useCallback(async (kind, throwOnError = false) => {
    setLoading(true);
    setNotice("");
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const paths = {
        salary: `/api/v1/reports/salary?month=${month}&year=${year}`,
        monthly: `/api/v1/reports/monthly-attendance?month=${month}&year=${year}`,
        daily: `/api/v1/reports/daily-attendance`,
        shiftManagement: `/api/v1/reports/shift-management`,
      };
      const data = await api(paths[kind]);
      setReports((current) => ({ ...current, [kind]: data }));
    } catch (error) {
      setNotice(error.message);
      if (throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!token) return;
    if (view === "salary_report") loadReport("salary");
    if (view === "monthly_attendance" || view === "monthly_report") loadReport("monthly");
    if (view === "daily_report") loadReport("daily");
    if (view === "shifts") loadReport("shiftManagement");
  }, [loadReport, view, token]);

  const refreshCurrentView = useCallback(async () => {
    if (!token || loading) return;
    try {
      await refreshData(true);
      if (view === "leaves") await loadLeaveBalances(true);
      if (view === "salary_report") await loadReport("salary", true);
      if (view === "monthly_attendance" || view === "monthly_report") await loadReport("monthly", true);
      if (view === "daily_report") await loadReport("daily", true);
      if (view === "shifts") await loadReport("shiftManagement", true);
      if (view === "audit_logs") await loadAuditLogs(auditLogPage, true);
      setNotice("Data refreshed successfully.");
    } catch (error) {
      setNotice(error.message);
    }
  }, [auditLogPage, loadAuditLogs, loadLeaveBalances, loadReport, loading, refreshData, token, view]);

  const login = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    const loginMode = form.get("login_mode");
    const identifier = String(form.get("identifier") || "").trim();
    try {
      const data = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          loginMode === "admin"
            ? { username: identifier, password: form.get("password") }
            : { employee_id: Number(identifier), password: form.get("password") },
        ),
      }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "Login failed.");
        return body;
      });
      localStorage.setItem("ems_user", JSON.stringify(data.user));
      setToken("cookie");
      setUser(data.user);
      setView(data.user?.role === "admin" ? "dashboard" : "profile");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Local session cleanup should still happen if the network request fails.
    }
    clearSession();
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const oldPassword = passwordResetForm.old_password.trim();
      const newPassword = passwordResetForm.new_password.trim();
      const confirmPassword = passwordResetForm.confirm_password.trim();
      if (!oldPassword || !newPassword || !confirmPassword) {
        throw new Error("Enter current password, new password, and confirmation.");
      }
      if (newPassword.length < 6) {
        throw new Error("New password must be at least 6 characters.");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }
      await api("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      setPasswordResetForm(emptyPasswordReset);
      setNotice("Password reset successfully.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const uploadProfilePhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please upload an image file.");
      return;
    }
    if (file.size > 700 * 1024) {
      setNotice("Profile photo must be under 700 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setLoading(true);
      setNotice("");
      try {
        const updated = await api("/api/v1/auth/me/profile", {
          method: "PATCH",
          body: JSON.stringify({ profile_photo: String(reader.result || "") }),
        });
        localStorage.setItem("ems_user", JSON.stringify(updated));
        setUser(updated);
        setNotice("Profile photo updated successfully.");
        await refreshData();
      } catch (error) {
        setNotice(error.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveEmployee = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      if (editingEmployeeId) {
        await api(`/api/v1/employees/${editingEmployeeId}`, {
          method: "PATCH",
          body: JSON.stringify({
            basic_salary: Number(employeeForm.basic_salary || 0),
            department: employeeForm.department,
            email: employeeForm.email,
            name: employeeForm.name,
            phone: employeeForm.phone,
          }),
        });
      } else {
        await api("/api/v1/employees", {
          method: "POST",
          body: JSON.stringify({
            ...employeeForm,
            employee_id: Number(employeeForm.employee_id),
            basic_salary: Number(employeeForm.basic_salary || 0),
          }),
        });
      }
      setEmployeeForm(emptyEmployee);
      setEditingEmployeeId(null);
      setNotice(editingEmployeeId ? "Employee updated successfully." : "Employee created successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const editEmployee = (employee) => {
    setEditingEmployeeId(employee.employee_id);
    setEmployeeForm({
      employee_id: employee.employee_id || "",
      name: employee.name || "",
      department: employee.department || "",
      basic_salary: employee.basic_salary ?? "",
      email: employee.email || "",
      phone: employee.phone || "",
      password: "",
      role: employee.role || "employee",
    });
    setView("add_edit");
  };

  const resetEmployeeForm = () => {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployee);
  };

  const setEmployeeActive = async (employeeId, active) => {
    setLoading(true);
    setNotice("");
    try {
      await api(active ? `/api/v1/employees/${employeeId}/restore` : `/api/v1/employees/${employeeId}`, {
        method: active ? "POST" : "DELETE",
      });
      setNotice(active ? "Employee restored successfully." : "Employee deactivated successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteEmployeeById = async (event) => {
    event.preventDefault();
    const employeeId = Number(deleteEmployeeId);
    if (!employeeId) {
      setNotice("Enter an employee ID.");
      return;
    }
    if (employeeId === Number(user?.employee_id || user?.emp_id)) {
      setNotice("You cannot delete the currently logged-in admin account.");
      return;
    }
    const targetEmployee = employees.find((employee) => Number(employee.employee_id || employee.emp_id) === employeeId);
    if (targetEmployee?.role === "admin") {
      setNotice("Admin accounts are not shown in All Employees and cannot be deleted here.");
      return;
    }
    const confirmed = window.confirm(
      `Deactivate account for Employee ${employeeId}? They can be restored by Admin later.`,
    );
    if (!confirmed) return;
    setLoading(true);
    setNotice("");
    try {
      await api(`/api/v1/employees/${employeeId}`, { method: "DELETE" });
      setDeleteEmployeeId("");
      setIncludeDeactivated(false);
      setNotice(`Employee ID ${employeeId} deactivated successfully.`);
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const reviewLeave = async (leaveId, status) => {
    setLoading(true);
    setNotice("");
    try {
      await api(`/api/v1/leaves/${leaveId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status, remarks: "" }),
      });
      setNotice(`Leave ${status.toLowerCase()} successfully.`);
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const revertLeave = async (leaveId) => {
    const reason = window.prompt("Enter reason for leave reversion:");
    if (reason === null) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setNotice("Enter a reason to request leave reversion.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      await api(`/api/v1/leaves/${leaveId}/revert`, {
        method: "PATCH",
        body: JSON.stringify({ reason: trimmedReason }),
      });
      setNotice("Leave revert request submitted successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const submitLeave = async (event) => {
    event.preventDefault();
    if (leaveForm.from_date && leaveForm.from_date < tomorrowDateISO()) {
      setNotice("Leave requests must be submitted at least one day before the leave date.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      await api("/api/v1/leaves", {
        method: "POST",
        body: JSON.stringify(leaveForm),
      });
      setLeaveForm(emptyLeave);
      setNotice("Leave request submitted successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const cancelLeave = async (leaveId) => {
    setLoading(true);
    setNotice("");
    try {
      await api(`/api/v1/leaves/${leaveId}/cancel`, { method: "PATCH" });
      setNotice("Leave request cancelled successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveLeaveBalance = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const employeeId = Number(leaveBalanceForm.employee_id);
      const totalLeaves = Number(leaveBalanceForm.total_leaves);
      if (!employeeId || Number.isNaN(totalLeaves)) {
        throw new Error("Employee ID and total leaves must be numbers.");
      }
      await api(`/api/v1/leaves/balances/${employeeId}`, {
        method: "PUT",
        body: JSON.stringify({ total_leaves: totalLeaves }),
      });
      setLeaveBalanceForm(emptyLeaveBalance);
      setNotice(`Set ${totalLeaves} leaves for Employee ID ${employeeId}.`);
      await loadLeaveBalances();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveSalaryRevision = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const employeeId = Number(salaryRevisionForm.employee_id);
      const amount = Number(salaryRevisionForm.amount);
      if (!employeeId || Number.isNaN(amount)) {
        throw new Error("Employee ID and salary amount must be numbers.");
      }
      await api(`/api/v1/employees/${employeeId}/salary`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          effective_from: salaryRevisionForm.effective_from || localDateISO(),
          note: salaryRevisionForm.note || null,
        }),
      });
      setSalaryRevisionForm(emptySalaryRevision);
      setNotice(`Salary updated for Employee ID ${employeeId}.`);
      await refreshData();
      await loadReport("salary");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveShiftAssignment = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const employeeId = Number(shiftAssignmentForm.employee_id);
      if (!employeeId) throw new Error("Enter an employee ID.");
      await api("/api/v1/shifts/assignments", {
        method: "POST",
        body: JSON.stringify({
          employee_id: employeeId,
          shift_name: shiftAssignmentForm.shift_name,
          effective_from: shiftAssignmentForm.effective_from || localDateISO(),
        }),
      });
      setShiftAssignmentForm((current) => ({ ...emptyShiftAssignment, shift_name: current.shift_name }));
      setNotice(`Shift updated for Employee ID ${employeeId}.`);
      await refreshData();
      await loadReport("shiftManagement");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const approveSundayWork = async (event) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const employeeId = Number(sundayWorkForm.employee_id);
      if (!employeeId) throw new Error("Enter an employee ID.");
      await api("/api/v1/shifts/sunday-work", {
        method: "POST",
        body: JSON.stringify({
          employee_id: employeeId,
          work_date: sundayWorkForm.work_date || localDateISO(),
          reason: sundayWorkForm.reason,
        }),
      });
      setSundayWorkForm({ ...emptySundayWork, work_date: sundayWorkForm.work_date || localDateISO() });
      setNotice(`Sunday work approved for Employee ID ${employeeId}.`);
      await loadReport("shiftManagement");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const markAttendance = async (action) => {
    setLoading(true);
    setNotice("");
    try {
      await api(`/api/v1/attendance/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(action === "check-in" ? "Checked in successfully." : "Checked out successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveManualAttendance = useCallback(async (payload) => {
    await api("/api/v1/attendance/manual", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }, [api]);

  const markManualAttendance = async (action) => {
    setLoading(true);
    setNotice("");
    try {
      const employeeId = Number(manualAttendanceForm.employee_id);
      if (!employeeId) throw new Error("Enter an employee ID.");
      const workDate = manualAttendanceForm.work_date || localDateISO();
      const existing = attendanceRecords.find((row) => sameEmployee(row, employeeId));
      const selectedTime = manualAttendanceForm.check_in || localTimeInput();
      const existingCheckIn = timeInputValue(existing?.check_in || existing?.arrival_time);
      const existingCheckOut = timeInputValue(existing?.check_out || existing?.checkout_time);
      const payload = {
        employee_id: employeeId,
        work_date: workDate,
        status: "Present",
        check_in: existingCheckIn || null,
        check_out: existingCheckOut || null,
        note: manualAttendanceForm.note || null,
      };
      if (action === "check-in") {
        payload.check_in = selectedTime;
      } else if (action === "check-out") {
        if (!payload.check_in) throw new Error("Check in this employee before checking out.");
        payload.check_out = selectedTime;
      } else if (action === "absent") {
        payload.status = "Absent";
        payload.check_in = null;
        payload.check_out = null;
      }
      await saveManualAttendance(payload);
      setManualAttendanceForm((current) => ({ ...current, employee_id: "", check_in: "", check_out: "", note: "" }));
      setNotice("Attendance updated successfully.");
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const markBulkAttendance = async (action) => {
    setLoading(true);
    setNotice("");
    try {
      const workDate = manualAttendanceForm.work_date || localDateISO();
      const selectedTime = manualAttendanceForm.check_in || "09:00";
      const markedIds = new Set(attendanceRecords.map((row) => String(row.employee_id || row.emp_id || "")));
      const targetEmployees =
        action === "auto-absent"
          ? activeEmployees.filter((employee) => !markedIds.has(String(employee.employee_id || employee.emp_id)))
          : activeEmployees;
      await Promise.all(
        targetEmployees.map((employee) =>
          saveManualAttendance({
            employee_id: Number(employee.employee_id || employee.emp_id),
            work_date: workDate,
            status: action === "present" ? "Present" : "Absent",
            check_in: action === "present" ? selectedTime : null,
            check_out: null,
            note: action === "present" ? "Bulk marked present" : "Auto-marked absent",
          }),
        ),
      );
      setNotice(`${targetEmployees.length} attendance records updated.`);
      await refreshData();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const employeeRows = employees.filter((employee) => employee.role !== "admin");
    if (!normalized) return employeeRows;
    return employeeRows.filter((employee) =>
      [employee.name, employee.department, employee.email, String(employee.employee_id)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [employees, query]);

  const activeEmployees = useMemo(
    () => employees.filter((employee) => !employee.deleted && employee.role !== "admin"),
    [employees],
  );
  const activeEmployeeIds = useMemo(
    () => new Set(activeEmployees.map((employee) => String(employee.employee_id || employee.emp_id || ""))),
    [activeEmployees],
  );

  const departments = useMemo(() => {
    const counts = activeEmployees.reduce((acc, employee) => {
      const rawName = String(employee.department || "").trim().replace(/\s+/g, " ");
      const key = rawName || "Unassigned";
      const normalized = key.toLowerCase();
      const existing = acc.get(normalized);
      acc.set(normalized, {
        name: existing?.name || key,
        count: (existing?.count || 0) + 1,
      });
      return acc;
    }, new Map());
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(({ name, count }) => [name, count]);
  }, [activeEmployees]);

  const today = localDateISO();
  const todayLeaveCount = leaves.filter(
    (leave) =>
      activeEmployeeIds.has(String(leave.employee_id || leave.emp_id || "")) &&
      leave.status === "Approved" &&
      (!leave.from_date || leave.from_date <= today) &&
      (!leave.to_date || leave.to_date >= today),
  ).length;
  const pendingLeaveCount = leaves.filter(
    (leave) =>
      activeEmployeeIds.has(String(leave.employee_id || leave.emp_id || "")) &&
      (leave.status === "Pending" || leave.status === "Revert Requested"),
  ).length;
  const todayPresentCount = Number(summaryValue(summary, "Present")) + Number(summaryValue(summary, "Half Day"));
  const notifications = useMemo(() => {
    const employeeNameById = new Map(
      employees.map((employee) => [String(employee.employee_id || employee.emp_id || ""), employee.name || "Employee"]),
    );
    const selectedAttendance = isAdmin ? attendanceRecords : todayAttendance;
    const currentEmployeeId = String(user?.employee_id || user?.emp_id || "");
    const items = [];

    if (isAdmin) {
      const pendingLeaves = leaves.filter((leave) => (
        activeEmployeeIds.has(String(leave.employee_id || leave.emp_id || "")) &&
        (leave.status === "Pending" || leave.status === "Revert Requested")
      ));
      if (pendingLeaves.length) {
        items.push({
          title: `${pendingLeaves.length} leave action${pendingLeaves.length === 1 ? "" : "s"} pending`,
          body: "Review approvals in Leave Requests.",
          tone: "warning",
          view: "leave_requests",
        });
      }

      const markedIds = new Set(selectedAttendance.map((row) => String(row.employee_id || row.emp_id || "")));
      const missingCount = activeEmployees.filter((employee) => (
        !markedIds.has(String(employee.employee_id || employee.emp_id || ""))
      )).length;
      if (missingCount) {
        items.push({
          title: `${missingCount} attendance record${missingCount === 1 ? "" : "s"} not marked`,
          body: "Open Attendance to update today's records.",
          tone: "danger",
          view: "attendance",
        });
      }

      const missedCheckoutCount = selectedAttendance.filter((row) => (
        (row.check_in || row.arrival_time) && !(row.check_out || row.checkout_time)
      )).length;
      if (missedCheckoutCount) {
        items.push({
          title: `${missedCheckoutCount} pending check-out${missedCheckoutCount === 1 ? "" : "s"}`,
          body: "Employees have check-ins without check-outs.",
          tone: "warning",
          view: "attendance",
        });
      }

      const inactiveCount = employees.filter((employee) => employee.deleted && employee.role !== "admin").length;
      if (inactiveCount) {
        items.push({
          title: `${inactiveCount} inactive employee${inactiveCount === 1 ? "" : "s"}`,
          body: "Restore or review deactivated accounts.",
          tone: "neutral",
          view: "employees",
        });
      }
    } else {
      const myAttendance = todayAttendance.find((row) => sameEmployee(row, currentEmployeeId));
      if (!myAttendance) {
        items.push({
          title: "Attendance not marked today",
          body: "Check in from My Attendance.",
          tone: "warning",
          view: "attendance",
        });
      } else if ((myAttendance.check_in || myAttendance.arrival_time) && !(myAttendance.check_out || myAttendance.checkout_time)) {
        items.push({
          title: "Check-out pending",
          body: "Remember to check out before leaving.",
          tone: "warning",
          view: "attendance",
        });
      } else {
        items.push({
          title: "Attendance is up to date",
          body: `Today status: ${myAttendance.status || "Present"}.`,
          tone: "success",
          view: "attendance",
        });
      }

      const myPendingLeaves = leaves.filter((leave) => (
        sameEmployee(leave, currentEmployeeId) && leave.status === "Pending"
      )).length;
      if (myPendingLeaves) {
        items.push({
          title: `${myPendingLeaves} leave request${myPendingLeaves === 1 ? "" : "s"} awaiting review`,
          body: "Track status in My Leaves.",
          tone: "warning",
          view: "my_leaves",
        });
      }

      const approvedToday = leaves.find((leave) => (
        sameEmployee(leave, currentEmployeeId) &&
        leave.status === "Approved" &&
        (!leave.from_date || leave.from_date <= today) &&
        (!leave.to_date || leave.to_date >= today)
      ));
      if (approvedToday) {
        items.push({
          title: "Approved leave today",
          body: `${approvedToday.leave_type || "Leave"} is active for ${employeeNameById.get(currentEmployeeId) || "you"}.`,
          tone: "success",
          view: "my_leaves",
        });
      }
    }

    return items;
  }, [activeEmployeeIds, activeEmployees, attendanceRecords, employees, isAdmin, leaves, today, todayAttendance, user]);

  const stats = [
    { label: "Total employees", value: activeEmployees.length, tone: "text", icon: Users },
    { label: "Present today", value: todayPresentCount, tone: "success", icon: CheckCircle2 },
    {
      label: "On leave",
      value: todayLeaveCount,
      tone: "warning",
      icon: CalendarCheck,
    },
    {
      label: "Pending approvals",
      value: pendingLeaveCount,
      tone: "danger",
      icon: ShieldCheck,
    },
  ];

  if (!token) {
    return <LoginScreen loading={loading} notice={notice} onSubmit={login} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Building2 size={17} />
          </span>
          <span>EMS</span>
        </div>
        <div className="panel-label">{isAdmin ? "ADMIN PANEL" : "EMPLOYEE PANEL"}</div>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${view === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="main-panel">
        <div className="topbar-layer">
          <header className="topbar">
            <div>
              <p className="eyebrow">Employee Management System</p>
              <h1>{viewTitle(view)}</h1>
            </div>
            <div className="top-actions">
              <button
                className="icon-button"
                disabled={loading}
                onClick={refreshCurrentView}
                title={loading ? "Refreshing data" : "Refresh data"}
                type="button"
              >
                <RefreshCw className={loading ? "spin-icon" : ""} size={18} />
              </button>
              <button
                className={`icon-button notification-button ${notificationsOpen ? "active" : ""}`}
                onClick={() => setNotificationsOpen((current) => !current)}
                title="Notifications"
                type="button"
              >
                <Bell size={18} />
                {notifications.length ? <span className="notification-count">{notifications.length}</span> : null}
              </button>
              <button
                className="avatar avatar-button"
                onClick={() => setProfileOpen((current) => !current)}
                title="Profile"
                type="button"
              >
                {user?.profile_photo ? (
                  <img alt="" src={user.profile_photo} />
                ) : (
                  initials(user?.name || "Admin")
                )}
              </button>
              <button className="ghost-button logout-button" onClick={logout}>
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </header>

          {notificationsOpen || profileOpen ? (
            <div className="topbar-popovers">
              {notificationsOpen ? (
                <NotificationPanel
                  items={notifications}
                  onClose={() => setNotificationsOpen(false)}
                  onNavigate={(targetView) => {
                    setView(targetView);
                    setNotificationsOpen(false);
                  }}
                />
              ) : null}

              {profileOpen ? (
                <ProfileMenu
                  loading={loading}
                  onClose={() => setProfileOpen(false)}
                  onPhotoChange={uploadProfilePhoto}
                  onResetPassword={() => {
                    setView("reset_password");
                    setProfileOpen(false);
                  }}
                  user={user}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {notice ? <div className="notice">{notice}</div> : null}

        {view === "dashboard" && isAdmin && (
          <Dashboard
            departments={departments}
            employees={activeEmployees}
            stats={stats}
            summary={summary}
            user={user}
          />
        )}
        {(view === "employees" || view === "add_edit") && isAdmin && (
          <EmployeesView
            employees={filteredEmployees}
            form={employeeForm}
            includeDeactivated={view !== "add_edit" && includeDeactivated}
            loading={loading}
            query={query}
            setForm={setEmployeeForm}
            setIncludeDeactivated={view === "add_edit" ? undefined : setIncludeDeactivated}
            setQuery={setQuery}
            onCancelEdit={resetEmployeeForm}
            onEdit={editEmployee}
            onSave={saveEmployee}
            onSetActive={view === "add_edit" ? undefined : setEmployeeActive}
            editingEmployeeId={editingEmployeeId}
            mode={view}
          />
        )}
        {view === "delete" && isAdmin && (
          <DeleteEmployeeView
            employeeId={deleteEmployeeId}
            loading={loading}
            onSubmit={deleteEmployeeById}
            setEmployeeId={setDeleteEmployeeId}
          />
        )}
        {view === "attendance" && (
          <AttendanceView
            attendance={isAdmin ? attendanceRecords : todayAttendance}
            employees={activeEmployees}
            filter={attendanceFilter}
            form={manualAttendanceForm}
            isAdmin={isAdmin}
            loading={loading}
            onCheckIn={() => markAttendance("check-in")}
            onCheckOut={() => markAttendance("check-out")}
            onAdminAction={markManualAttendance}
            onBulkAction={markBulkAttendance}
            onManualSubmit={markManualAttendance}
            setFilter={setAttendanceFilter}
            setForm={setManualAttendanceForm}
            user={user}
          />
        )}
        {view === "leaves" && isAdmin && (
          <ManageLeavesView
            balances={leaveBalances}
            filter={leaveBalanceFilter}
            form={leaveBalanceForm}
            loading={loading}
            onSubmit={saveLeaveBalance}
            setFilter={setLeaveBalanceFilter}
            setForm={setLeaveBalanceForm}
          />
        )}
        {(view === "leave_requests" || view === "my_leaves" || view === "request_leave") && (
          <LeavesView
            employees={employees}
            form={leaveForm}
            isAdmin={isAdmin}
            leaves={leaves}
            loading={loading}
            onCancel={cancelLeave}
            onReview={reviewLeave}
            onRevert={revertLeave}
            onSubmit={submitLeave}
            setForm={setLeaveForm}
            view={view}
          />
        )}
        {view === "shifts" && isAdmin && (
          <ShiftManagementView
            assignmentForm={shiftAssignmentForm}
            data={reports.shiftManagement}
            loading={loading}
            onApproveSunday={approveSundayWork}
            onAssign={saveShiftAssignment}
            setAssignmentForm={setShiftAssignmentForm}
            setSundayForm={setSundayWorkForm}
            shifts={shifts}
            sundayForm={sundayWorkForm}
          />
        )}
        {view === "salary_report" && isAdmin && (
          <SalaryReportView
            data={reports.salary}
            form={salaryRevisionForm}
            loading={loading}
            onSubmit={saveSalaryRevision}
            setForm={setSalaryRevisionForm}
          />
        )}
        {(view === "monthly_attendance" || view === "monthly_report") && (
          <MonthlyAttendanceView data={reports.monthly} />
        )}
        {view === "daily_report" && isAdmin && <DailyReportView data={reports.daily} />}
        {view === "audit_logs" && isAdmin && (
          <AuditLogsView
            data={auditLogs}
            loading={loading}
            onPageChange={setAuditLogPage}
          />
        )}
        {view === "reset_password" && (
          <PasswordResetView
            form={passwordResetForm}
            loading={loading}
            onSubmit={changePassword}
            setForm={setPasswordResetForm}
            user={user}
          />
        )}
        {view === "profile" && <ProfileView employee={employees[0] || user} />}
      </main>
    </div>
  );
}

function NotificationPanel({ items, onClose, onNavigate }) {
  return (
    <section className="notification-panel">
      <div className="panel-heading">
        <div>
          <h3>Notifications</h3>
          <span>{items.length ? `${items.length} active` : "All clear"}</span>
        </div>
        <button className="ghost-button notification-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="notification-list">
        {items.length ? items.map((item, index) => (
          <button
            className="notification-item"
            key={`${item.title}-${index}`}
            onClick={() => onNavigate(item.view)}
            type="button"
          >
            <span className={`notification-dot ${item.tone}`} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.body}</small>
            </span>
          </button>
        )) : (
          <div className="notification-empty">
            <CheckCircle2 size={18} />
            <span>No new notifications.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileMenu({ loading, onClose, onPhotoChange, onResetPassword, user }) {
  const isAdminAccount = user?.role === "admin";

  return (
    <section className="profile-menu-panel">
      <div className="panel-heading">
        <div>
          <h3>Profile</h3>
          <span>{displayValue(user?.role)} account</span>
        </div>
        <button className="ghost-button notification-close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="profile-menu-body">
        <div className="profile-summary-row">
          <span className="profile-photo-preview">
            {user?.profile_photo ? <img alt="" src={user.profile_photo} /> : initials(user?.name || "User")}
          </span>
          <div>
            <strong>{displayValue(user?.name)}</strong>
            <span>{displayValue(user?.email)}</span>
          </div>
          <label className={`secondary-button photo-upload-button ${loading ? "disabled" : ""}`}>
            Upload Photo
            <input accept="image/*" disabled={loading} onChange={onPhotoChange} type="file" />
          </label>
        </div>
        <div className="profile-readonly-grid">
          <InfoItem
            label={isAdminAccount ? "Username" : "Employee ID"}
            value={isAdminAccount ? user?.username || "admin" : user?.employee_id || user?.emp_id}
          />
          <InfoItem label="Department" value={user?.department} />
          <InfoItem label="Role" value={user?.role} />
          <InfoItem label="Phone" value={user?.phone} />
        </div>
        <button className="profile-menu-action" onClick={onResetPassword} type="button">
          <ShieldCheck size={16} />
          <span>Reset Password</span>
        </button>
      </div>
    </section>
  );
}

function LoginScreen({ loading, notice, onSubmit }) {
  const [mode, setMode] = useState("admin");
  return (
    <main className="login-layout">
      <section className="login-preview" aria-hidden="true">
        <div className="ems-logo-lockup">
          <span className="ems-logo-ring">
            <Users size={34} />
          </span>
          <strong>EMS</strong>
          <span>Employee Management System</span>
          <p>Track. Manage. Succeed.</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="brand large">
          <span className="brand-mark">
            <Building2 size={20} />
          </span>
          <span>EMS</span>
        </div>
        <div className="login-toggle" role="group" aria-label="Login mode">
          <button className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")} type="button">
            Admin
          </button>
          <button className={mode === "employee" ? "active" : ""} onClick={() => setMode("employee")} type="button">
            Employee
          </button>
        </div>
        <h1>{mode === "admin" ? "Admin Login" : "Employee Login"}</h1>
        <p>
          {mode === "admin"
            ? "Use the admin username and password from your backend .env file."
            : "Use the employee ID and password from the existing EMS records."}
        </p>
        {notice ? <div className="notice compact">{notice}</div> : null}
        <form className="login-form" onSubmit={onSubmit}>
          <input name="login_mode" type="hidden" value={mode} />
          <label>
            {mode === "admin" ? "Admin Username" : "Employee ID"}
            <input
              name="identifier"
              type="text"
              inputMode={mode === "admin" ? undefined : "numeric"}
              pattern={mode === "admin" ? undefined : "[0-9]*"}
              required
            />
          </label>
          <label>
            {mode === "admin" ? "Admin Password" : "Password"}
            <input
              name="password"
              type="password"
              required
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? "Signing in..." : mode === "admin" ? "Sign in as admin" : "Sign in as employee"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ departments, employees, stats, summary, user }) {
  const attendanceRows = ["Present", "Absent", "Half Day", "Leave", "Holiday"].map((label) => ({
    label,
    value: Number(summaryValue(summary, label)),
  }));
  const maxAttendance = Math.max(1, ...attendanceRows.map((row) => row.value));
  const departmentTotal = Math.max(1, departments.reduce((total, [, count]) => total + count, 0));

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Good day, {user?.name || "Admin"}</p>
          <h2>{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h2>
        </div>
      </section>

      <section className="stat-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.label}>
              <div>
                <p>{stat.label}</p>
                <strong className={stat.tone}>{stat.value}</strong>
              </div>
              <span className={`stat-icon ${stat.tone}`}>
                <Icon size={18} />
              </span>
            </article>
          );
        })}
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel-heading">
            <h3>Attendance summary</h3>
            <span>Current filters</span>
          </div>
          <div className="bar-chart">
            {attendanceRows.map(({ label, value }) => {
              const height = value ? Math.max(8, (value / maxAttendance) * 100) : 0;
              return (
                <div className="bar-column" key={label}>
                  <strong>{value}</strong>
                  <span style={{ height: `${height}%` }} />
                  <small>{label.split(" ")[0]}</small>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h3>Department split</h3>
            <span>{employees.length} employees</span>
          </div>
          <div className="progress-list">
            {departments.length ? (
              departments.map(([name, count]) => (
                <div className="progress-row" key={name}>
                  <div>
                    <span>{name}</span>
                    <strong>{count}</strong>
                  </div>
                  <div className="track">
                    <span style={{ width: `${Math.max(12, (count / departmentTotal) * 100)}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-text">No employee departments yet.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function EmployeesView({
  editingEmployeeId,
  employees,
  form,
  includeDeactivated,
  loading,
  mode,
  onCancelEdit,
  onEdit,
  onSave,
  onSetActive,
  query,
  setForm,
  setIncludeDeactivated,
  setQuery,
}) {
  const isFormMode = mode === "add_edit";
  const isDeleteMode = mode === "delete";
  const visibleEmployees = employees.filter((employee) => (
    isFormMode || !includeDeactivated ? !employee.deleted : true
  ));
  return (
    <div className={`employees-layout ${isFormMode ? "" : "single-column"}`}>
      {isFormMode ? <section className="panel employee-form-panel">
        <div className="panel-heading">
          <h3>{editingEmployeeId ? "Edit employee" : "Add employee"}</h3>
          <span>{editingEmployeeId ? `ID ${editingEmployeeId}` : "Admin"}</span>
        </div>
        <form className="employee-form" onSubmit={onSave}>
          <input
            placeholder="Employee ID"
            type="number"
            value={form.employee_id}
            onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
            disabled={!!editingEmployeeId}
            required
          />
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
          <input
            placeholder="Department"
            value={form.department}
            onChange={(event) => setForm({ ...form, department: event.target.value })}
            required
          />
          <input
            placeholder="Basic salary"
            type="number"
            value={form.basic_salary}
            onChange={(event) => setForm({ ...form, basic_salary: event.target.value })}
            required
          />
          <input
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <input
            placeholder="Phone"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <input
            placeholder="Temporary password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required={!editingEmployeeId}
            disabled={!!editingEmployeeId}
          />
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
            disabled={!!editingEmployeeId}
          >
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
          <div className="form-actions">
            <button className="primary-button" disabled={loading} type="submit">
              <Plus size={16} />
              {editingEmployeeId ? "Update employee" : "Add employee"}
            </button>
            {editingEmployeeId ? (
              <button className="secondary-button" disabled={loading} onClick={onCancelEdit} type="button">
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section> : null}

      <section className="panel">
        <div className="table-toolbar">
          <div>
            <h3>Employees</h3>
            <span>{visibleEmployees.length} records</span>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="Search employees"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {setIncludeDeactivated ? (
            <label className="toggle-control">
              <input
                checked={includeDeactivated}
                onChange={(event) => setIncludeDeactivated(event.target.checked)}
                type="checkbox"
              />
              Show deactivated
            </label>
          ) : null}
        </div>
        <EmployeeTable
          employees={visibleEmployees}
            mode={isDeleteMode ? "delete" : "default"}
            onEdit={isFormMode ? onEdit : undefined}
            onSetActive={onSetActive}
            title=""
          />
      </section>
    </div>
  );
}

function DeleteEmployeeView({ employeeId, loading, onSubmit, setEmployeeId }) {
  return (
    <section className="panel delete-employee-panel">
      <div className="panel-heading">
        <div>
          <h3>Delete Employee</h3>
          <span>Deactivate employee accounts only. Admin accounts are protected.</span>
        </div>
      </div>
      <form className="employee-form delete-employee-form" onSubmit={onSubmit}>
        <label>
          Employee ID to delete
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Enter employee ID"
            required
            type="text"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          />
        </label>
        <button className="primary-button danger-button" disabled={loading} type="submit">
          <Trash2 size={16} />
          Delete Employee
        </button>
      </form>
    </section>
  );
}

function AttendanceView({
  attendance,
  employees,
  filter,
  form,
  isAdmin,
  loading,
  onAdminAction,
  onBulkAction,
  onCheckIn,
  onCheckOut,
  setFilter,
  setForm,
  user,
}) {
  const rows = attendance
    .map((row) => {
      const rowEmployeeId = row.employee_id || row.emp_id;
      const employee = employees.find((item) => sameEmployee(item, rowEmployeeId)) || {};
      const currentUser = sameEmployee(user, rowEmployeeId) ? user : {};
      return {
        ...row,
        name: row.name || employee.name || currentUser.name || "-",
        department: row.department || employee.department || currentUser.department || "-",
      };
    })
    .filter((row) => attendanceMatchesFilter(row, filter))
    .sort((first, second) => compareEmployeeIds(first, second));

  return (
    <div className="page-stack">
      <section className="action-band">
        <div>
          <p className="eyebrow">Today: {displayDate(form.work_date || localDateISO())}</p>
          <h2>{user?.role === "admin" ? "Attendance Management" : "Your attendance"}</h2>
        </div>
        {!isAdmin ? (
          <div className="button-row">
            <button className="primary-button" disabled={loading} onClick={onCheckIn}>
              Check in
            </button>
            <button className="secondary-button" disabled={loading} onClick={onCheckOut}>
              Check out
            </button>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section className="panel attendance-control-panel">
          <div className="attendance-controls">
            <label>
              Emp ID
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 101"
                type="text"
                value={form.employee_id}
                onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
              />
            </label>
            <label>
              Time (HH:MM)
              <input
                placeholder="09:00 (blank = now)"
                type="time"
                value={form.check_in}
                onChange={(event) => setForm({ ...form, check_in: event.target.value })}
              />
            </label>
          </div>
          <div className="attendance-button-row">
            <button className="mini-action success-bg" disabled={loading} onClick={() => onAdminAction("check-in")} type="button">
              Check In
            </button>
            <button className="mini-action info-bg" disabled={loading} onClick={() => onAdminAction("check-out")} type="button">
              Check Out
            </button>
            <button className="mini-action danger-bg" disabled={loading} onClick={() => onAdminAction("absent")} type="button">
              Mark Absent
            </button>
            <button className="mini-action amber-bg" disabled={loading} onClick={() => onBulkAction("auto-absent")} type="button">
              Auto-Mark All Absent
            </button>
            <button className="mini-action success-bg" disabled={loading} onClick={() => onBulkAction("present")} type="button">
              Mark All Present
            </button>
          </div>
        </section>
      ) : null}

      <article className="panel">
        <div className="panel-heading">
          <h3>{isAdmin ? "Today's Attendance" : "Today"}</h3>
          <span>{rows.length} records</span>
        </div>
        {isAdmin ? (
          <div className="attendance-toolbar">
            <div className="attendance-filters">
              <span>Filter:</span>
              {["All", "Present", "Late", "Half-Day", "Absent"].map((item) => (
                <button
                  className={`filter-chip ${filter === item ? "active" : ""} ${filterTone(item)}`}
                  key={item}
                  onClick={() => setFilter(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="date-filter">
              Date:
              <input
                required
                type="date"
                value={form.work_date}
                onChange={(event) => setForm({ ...form, work_date: event.target.value })}
              />
            </label>
          </div>
        ) : null}
        <table className="data-table">
          <thead>
            <tr>
              <th>Emp ID</th>
              <th>Name</th>
              <th>Dept</th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th>Hrs</th>
              <th>Late</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id || `${row.employee_id}-${row.work_date}`}>
                <td>{row.employee_id}</td>
                <td>{row.name}</td>
                <td>{row.department}</td>
                <td><Badge tone={attendanceStatusTone(row)}>{row.status || "Present"}</Badge></td>
                <td>{formatTime(row.check_in)}</td>
                <td>{formatTime(row.check_out)}</td>
                <td>{displayValue(row.hours_worked)}</td>
                <td>{lateDisplay(row)}</td>
              </tr>
            )) : (
              <tr>
                <td className="empty-text" colSpan={8}>No records found for {displayDate(form.work_date || localDateISO())}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </article>
    </div>
  );
}

function ManageLeavesView({ balances, filter, form, loading, onSubmit, setFilter, setForm }) {
  const rows = balances.filter((row) => {
    if (filter === "Has Leaves") return Number(row.remaining || 0) > 0;
    if (filter === "No Leaves") return Number(row.remaining || 0) <= 0;
    return true;
  });
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Manage Leaves</h3>
            <span>Set total allowed leaves per employee</span>
          </div>
        </div>
        <form className="leave-balance-form" onSubmit={onSubmit}>
          <label>
            Employee ID
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 101"
              required
              type="text"
              value={form.employee_id}
              onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
            />
          </label>
          <label>
            Total Leaves
            <input
              inputMode="numeric"
              min="0"
              placeholder="e.g. 20"
              required
              type="number"
              value={form.total_leaves}
              onChange={(event) => setForm({ ...form, total_leaves: event.target.value })}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            Set Leaves
          </button>
        </form>
      </section>

      <article className="panel">
        <div className="panel-heading">
          <h3>Leave Summary - All Employees</h3>
          <span>{rows.length} records</span>
        </div>
        <div className="attendance-filters leave-filters">
          <span>Filter:</span>
          {["All", "Has Leaves", "No Leaves"].map((item) => (
            <button
              className={`filter-chip ${filter === item ? "active" : ""} ${item === "Has Leaves" ? "success" : item === "No Leaves" ? "danger" : "neutral"}`}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Emp ID</th>
              <th>Name</th>
              <th>Dept</th>
              <th>Total</th>
              <th>Used</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.employee_id}>
                <td>{row.employee_id}</td>
                <td>{row.name}</td>
                <td>{row.department}</td>
                <td>{formatLeaveNumber(row.total)}</td>
                <td>{formatLeaveNumber(row.used)}</td>
                <td>
                  <Badge tone={Number(row.remaining || 0) > 0 ? "success" : "danger"}>
                    {formatLeaveNumber(row.remaining)}
                  </Badge>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="empty-text" colSpan={6}>No leave balances found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </article>
    </div>
  );
}

function LeavesView({ employees = [], form, isAdmin, leaves, loading, onCancel, onReview, onRevert, onSubmit, setForm, view }) {
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const showRequestForm = !isAdmin && view === "request_leave";
  const showLeaveActions = (isAdmin && view === "leave_requests") || (!isAdmin && view === "my_leaves");
  const earliestLeaveDate = tomorrowDateISO();
  const leaveTypes = useMemo(() => (
    ["All", ...Array.from(new Set(leaves.map((leave) => displayValue(leave.leave_type)).filter((type) => type !== "-")))]
  ), [leaves]);
  const employeeNameById = useMemo(() => new Map(
    employees.map((employee) => [String(employee.employee_id || employee.emp_id || ""), employee.name]),
  ), [employees]);
  const visibleLeaves = useMemo(() => leaves.filter((leave) => {
    const status = displayValue(leave.status);
    const type = displayValue(leave.leave_type);
    const matchesStatus = statusFilter === "All" || status === statusFilter;
    const matchesType = typeFilter === "All" || type === typeFilter;
    return matchesStatus && matchesType;
  }), [leaves, statusFilter, typeFilter]);

  useEffect(() => {
    if (!selectedLeave) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setSelectedLeave(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLeave]);

  return (
    <div className={`leaves-layout ${showRequestForm ? "" : "single-column"}`}>
      {showRequestForm ? (
        <section className="panel">
          <div className="panel-heading">
            <h3>Request leave</h3>
            <span>Employee</span>
          </div>
          <form className="employee-form" onSubmit={onSubmit}>
            <select
              value={form.leave_type}
              onChange={(event) => setForm({ ...form, leave_type: event.target.value })}
              required
            >
              <option>Casual Leave</option>
              <option>Sick Leave</option>
              <option>Earned Leave</option>
              <option>Unpaid Leave</option>
            </select>
            <label>
              From Date
              <input
                min={earliestLeaveDate}
                type="date"
                value={form.from_date}
                onChange={(event) => setForm({ ...form, from_date: event.target.value })}
                required
              />
            </label>
            <label>
              To Date
              <input
                min={form.from_date || earliestLeaveDate}
                type="date"
                value={form.to_date}
                onChange={(event) => setForm({ ...form, to_date: event.target.value })}
                required
              />
            </label>
            <select
              value={form.duration}
              onChange={(event) => setForm({ ...form, duration: event.target.value })}
            >
              <option>Full Day</option>
              <option>Half Day</option>
              <option>Quarter Leave</option>
            </select>
            <textarea
              placeholder="Reason"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              required
            />
            <button className="primary-button" disabled={loading} type="submit">
              Submit request
            </button>
          </form>
        </section>
      ) : null}

      <article className="panel">
        <div className="panel-heading">
          <h3>{isAdmin ? "Leave requests" : "My leaves"}</h3>
          <span>{visibleLeaves.length} of {leaves.length} records</span>
        </div>
        <div className="leave-request-toolbar">
          <div className="attendance-filters leave-status-filters">
            {["All", "Pending", "Approved", "Rejected", "Cancelled", "Revert Requested"].map((item) => (
              <button
                className={`filter-chip ${statusFilter === item ? "active" : ""} ${leaveFilterTone(item)}`}
                key={item}
                onClick={() => setStatusFilter(item)}
                type="button"
              >
                {item === "Cancelled" ? "Reverted" : item}
              </button>
            ))}
          </div>
          <label className="leave-type-filter">
            Leave Type:
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              {leaveTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
        </div>
        <table className="data-table leave-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Duration</th>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeaves.length ? visibleLeaves.map((leave) => (
              <tr key={leave.id}>
                <td>{leave.employee_id}</td>
                <td>{leaveEmployeeName(leave, employeeNameById)}</td>
                <td>{leave.leave_type}</td>
                <td>{leave.duration || "-"}</td>
                <td>{displayDate(leave.from_date)}</td>
                <td>{displayDate(leave.to_date)}</td>
                <td>{formatLeaveNumber(leaveDays(leave))}</td>
                <td>{displayDate(leaveSubmittedDate(leave))}</td>
                <td><Badge tone={leaveStatusTone(leave.status)}>{leave.status}</Badge></td>
                <td>
                  <div className="table-actions">
                    <button className="mini-action info-bg" onClick={() => setSelectedLeave(leave)} type="button">
                      <Eye size={14} />
                      View
                    </button>
                    {showLeaveActions && isAdmin && leave.status === "Pending" ? (
                      <>
                        <button className="mini-action success-bg" onClick={() => onReview(leave.id, "Approved")} type="button">
                          Approve
                        </button>
                        <button className="mini-action danger-bg" onClick={() => onReview(leave.id, "Rejected")} type="button">
                          Reject
                        </button>
                      </>
                    ) : showLeaveActions && isAdmin && leave.status === "Revert Requested" ? (
                      <>
                        <button className="mini-action success-bg" onClick={() => onReview(leave.id, "Cancelled")} type="button">
                          Approve Revert
                        </button>
                        <button className="mini-action danger-bg" onClick={() => onReview(leave.id, "Approved")} type="button">
                          Reject Revert
                        </button>
                      </>
                    ) : showLeaveActions && !isAdmin && leave.status === "Pending" ? (
                      <button className="mini-action danger-bg" onClick={() => onCancel(leave.id)} type="button">
                        Cancel
                      </button>
                    ) : showLeaveActions && !isAdmin && leave.status === "Approved" ? (
                      <button className="mini-action amber-bg" disabled={loading} onClick={() => onRevert(leave.id)} type="button">
                        Revert
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="empty-text" colSpan={10}>No leave requests found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </article>

      {selectedLeave ? (
        <LeaveDetailsModal employeeNameById={employeeNameById} leave={selectedLeave} onClose={() => setSelectedLeave(null)} />
      ) : null}
    </div>
  );
}

function LeaveDetailsModal({ employeeNameById, leave, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section className="leave-modal" aria-labelledby="leave-detail-title" aria-modal="true" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="modal-heading">
          <div>
            <h3 id="leave-detail-title">Leave request details</h3>
            <span>Employee ID {displayValue(leave.employee_id)}</span>
          </div>
          <button className="icon-button" aria-label="Close leave details" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="leave-detail-grid">
          <InfoItem label="Employee ID" value={leave.employee_id} />
          <InfoItem label="Name" value={leaveEmployeeName(leave, employeeNameById)} />
          <InfoItem label="Leave Type" value={leave.leave_type} />
          <InfoItem label="From Date" value={leave.from_date} />
          <InfoItem label="To Date" value={leave.to_date} />
          <InfoItem label="Duration" value={leave.duration} />
          <InfoItem label="Days" value={formatLeaveNumber(leaveDays(leave))} />
          <InfoItem label="Submitted" value={displayDate(leaveSubmittedDate(leave))} />
          <div className="info-item">
            <span>Status</span>
            <strong><Badge tone={leaveStatusTone(leave.status)}>{displayValue(leave.status)}</Badge></strong>
          </div>
        </div>
        <div className="leave-detail-notes">
          <div>
            <span>Reason</span>
            <p>{displayValue(leave.reason)}</p>
          </div>
          <div>
            <span>Revert Reason</span>
            <p>{displayValue(leave.revert_reason)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProfileView({ employee }) {
  const role = displayValue(employee?.role);
  const employeeId = displayValue(employee?.employee_id || employee?.emp_id);
  const status = employee?.deleted === true ? "Inactive" : employee?.deleted === false ? "Active" : "-";

  return (
    <article className="panel profile-panel">
      <div className="profile-header">
        <span className="profile-avatar">{initials(employee?.name || "Employee")}</span>
        <div>
          <h3>{displayValue(employee?.name)}</h3>
          <p className="profile-meta">{role} - ID {employeeId}</p>
          <p>{employee?.role || "employee"} · ID {employee?.employee_id || "-"}</p>
        </div>
      </div>
      <div className="profile-grid">
        <InfoItem label="Department" value={employee?.department} />
        <InfoItem label="Email" value={employee?.email} />
        <InfoItem label="Phone" value={employee?.phone} />
        <InfoItem label="Basic salary" value={profileMoney(employee?.basic_salary)} />
        <InfoItem label="Joining date" value={employee?.joining_date} />
        <InfoItem label="Status" value={status} />
      </div>
    </article>
  );
}

function PasswordResetView({ form, loading, onSubmit, setForm, user }) {
  return (
    <article className="panel password-reset-panel">
      <div className="panel-heading">
        <div>
          <h3>Reset Password</h3>
          <span>{displayValue(user?.role)} account</span>
        </div>
      </div>
      <form className="password-reset-form" onSubmit={onSubmit}>
        <label>
          Current Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={form.old_password}
            onChange={(event) => setForm({ ...form, old_password: event.target.value })}
          />
        </label>
        <label>
          New Password
          <input
            autoComplete="new-password"
            minLength={6}
            required
            type="password"
            value={form.new_password}
            onChange={(event) => setForm({ ...form, new_password: event.target.value })}
          />
        </label>
        <label>
          Confirm Password
          <input
            autoComplete="new-password"
            minLength={6}
            required
            type="password"
            value={form.confirm_password}
            onChange={(event) => setForm({ ...form, confirm_password: event.target.value })}
          />
        </label>
        <div className="form-actions">
          <button className="primary-button" disabled={loading} type="submit">
            Save Password
          </button>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setForm(emptyPasswordReset)}
            type="button"
          >
            Clear
          </button>
        </div>
      </form>
    </article>
  );
}

function InfoItem({ label, value }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{displayValue(value)}</strong>
    </div>
  );
}

function ShiftManagementView({
  assignmentForm,
  data,
  loading,
  onApproveSunday,
  onAssign,
  setAssignmentForm,
  setSundayForm,
  shifts,
  sundayForm,
}) {
  const shiftEntries = data?.shifts?.length
    ? data.shifts.map((shift) => [shift.name || shift.shift_name || shift.id, shift])
    : Object.entries(shifts || {}).map(([name, shift]) => [name, { name, grace_minutes: 15, ...shift }]);
  const assignments = data?.assignments || [];
  return (
    <div className="page-stack">
      <section className="shift-grid">
        {shiftEntries.map(([name, shift]) => (
          <article className="panel shift-card" key={name}>
            <Clock3 color={shiftToneColor(name)} size={20} />
            <h3 style={{ color: shiftToneColor(name) }}>{name}</h3>
            <p>{shift.start || shift.start_time || "09:00"} to {shift.end || shift.end_time || "17:00"}</p>
            <span>{shift.hours || 8} hrs | Grace: {shift.grace_minutes || 15} min</span>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Assign / Update Shift</h3>
            <span>Assign Morning / Evening / Night for an employee</span>
          </div>
        </div>
        <form className="shift-action-form" onSubmit={onAssign}>
          <label>
            Employee ID
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 101"
              required
              type="text"
              value={assignmentForm.employee_id}
              onChange={(event) => setAssignmentForm({ ...assignmentForm, employee_id: event.target.value })}
            />
          </label>
          <label>
            Shift
            <select
              required
              value={assignmentForm.shift_name}
              onChange={(event) => setAssignmentForm({ ...assignmentForm, shift_name: event.target.value })}
            >
              {shiftEntries.map(([name]) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            Assigned On
            <input
              required
              type="date"
              value={assignmentForm.effective_from}
              onChange={(event) => setAssignmentForm({ ...assignmentForm, effective_from: event.target.value })}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            Assign / Update Shift
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Approve Sunday Work</h3>
            <span>Allow paid work attendance for approved Sundays only</span>
          </div>
        </div>
        <form className="shift-action-form sunday-work-form" onSubmit={onApproveSunday}>
          <label>
            Employee ID
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 101"
              required
              type="text"
              value={sundayForm.employee_id}
              onChange={(event) => setSundayForm({ ...sundayForm, employee_id: event.target.value })}
            />
          </label>
          <label>
            Date
            <input
              required
              type="date"
              value={sundayForm.work_date}
              onChange={(event) => setSundayForm({ ...sundayForm, work_date: event.target.value })}
            />
          </label>
          <label>
            Reason
            <input
              placeholder="e.g. operations coverage"
              required
              type="text"
              value={sundayForm.reason}
              onChange={(event) => setSundayForm({ ...sundayForm, reason: event.target.value })}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            Approve Sunday Work
          </button>
        </form>
      </section>
      <ReportTable
        tableClassName="shift-report-table"
        columns={[
          ["employee_id", "Emp ID"],
          ["name", "Name"],
          ["department", "Department"],
          ["shift_name", "Assigned Shift"],
          ["shift_hours", "Shift Hours"],
          ["effective_from", "Assigned On", displayDate],
        ]}
        downloadable={false}
        rows={assignments}
        title="All Shift Assignments"
      />
    </div>
  );
}

function SalaryReportView({ data, form, loading, onSubmit, setForm }) {
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Set Salary</h3>
            <span>Manage effective-date salary changes for accurate reports</span>
          </div>
        </div>
        <form className="salary-revision-form" onSubmit={onSubmit}>
          <label>
            Employee ID
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Emp ID"
              required
              type="text"
              value={form.employee_id}
              onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
            />
          </label>
          <label>
            Amount
            <input
              min="0"
              placeholder="e.g. 25000"
              required
              type="number"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </label>
          <label>
            Effective From
            <input
              required
              type="date"
              value={form.effective_from}
              onChange={(event) => setForm({ ...form, effective_from: event.target.value })}
            />
          </label>
          <label>
            Note
            <input
              placeholder="Revision note / reason"
              type="text"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            Save Revision
          </button>
        </form>
      </section>
      <section className="stat-grid">
        <article className="stat-card"><div><p>Total basic salary</p><strong>{money(data?.totals?.basic_salary)}</strong></div></article>
        <article className="stat-card"><div><p>Total gross salary</p><strong>{money(data?.totals?.gross_salary)}</strong></div></article>
        <article className="stat-card"><div><p>Total deductions</p><strong>{money(data?.totals?.total_deductions)}</strong></div></article>
        <article className="stat-card"><div><p>Total net salary</p><strong>{money(data?.totals?.net_salary)}</strong></div></article>
      </section>
      <ReportTable
        columns={[
          ["employee_id", "Emp ID"],
          ["name", "Name"],
          ["department", "Dept"],
          ["shift", "Shift"],
          ["basic_salary", "Base Salary", money],
          ["days_present", "Days P"],
          ["days_absent", "Days A"],
          ["days_halfday", "Half Day"],
          ["missed_checkouts", "Missed Out"],
          ["total_late_hours", "Late Hrs"],
          ["late_deduction", "Late Ded", money],
          ["early_exit_deduction", "Early Ded", money],
          ["absent_deduction", "Absent Ded", money],
          ["halfday_deduction", "Half Ded", money],
          ["total_ot_hours", "OT Hrs"],
          ["ot_pay", "OT Pay", money],
          ["net_salary", "Net Salary", money],
        ]}
        rows={data?.rows || []}
        title={`Salary report${data ? ` - ${monthYearLabel(data.month, data.year)}` : ""}`}
      />
    </div>
  );
}

function MonthlyAttendanceView({ data }) {
  return (
    <ReportTable
      columns={[
        ["employee_id", "Employee ID"],
        ["name", "Name"],
        ["department", "Department"],
        ["present", "Present"],
        ["absent", "Absent"],
        ["half_day", "Half Day"],
        ["leave", "Leave"],
        ["total_marked", "Total Marked"],
        ["attendance_percentage", "Attendance %", percent],
      ]}
      rows={data?.rows || []}
      title={`Monthly attendance${data ? ` - ${monthYearLabel(data.month, data.year)}` : ""}`}
    />
  );
}

function DailyReportView({ data }) {
  return (
    <ReportTable
      columns={[
        ["employee_id", "Employee ID"],
        ["name", "Name"],
        ["department", "Department"],
        ["shift", "Shift"],
        ["status", "Status"],
        ["check_in", "Check in", formatTime],
        ["check_out", "Check out", formatTime],
        ["hours_worked", "Hours"],
        ["late_hours", "Late"],
        ["overtime_hours", "Overtime"],
        ["marked_by", "Marked By"],
      ]}
      rows={data?.rows || []}
      title={`Daily report${data ? ` - ${data.date}` : ""}`}
    />
  );
}

function AuditLogsView({ data, loading, onPageChange }) {
  const rows = data?.rows || [];
  const page = Number(data?.page || 1);
  const totalPages = Number(data?.total_pages || 1);
  const total = Number(data?.total || 0);

  return (
    <article className="panel audit-log-panel">
      <div className="panel-heading">
        <div>
          <h3>Audit Logs</h3>
          <span>{total} total records</span>
        </div>
        <div className="pagination-controls">
          <button
            className="secondary-button"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
            type="button"
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            className="secondary-button"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
      <table className="data-table audit-log-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Performed By</th>
            <th>Target</th>
            <th>Details</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={`${row.timestamp || "audit"}-${row.action || index}-${index}`}>
              <td><Badge tone="info">{displayValue(row.action)}</Badge></td>
              <td>{displayValue(row.performed_by)}</td>
              <td>{auditTarget(row.target)}</td>
              <td>{auditDetails(row.details)}</td>
              <td>{formatDateTime(row.timestamp)}</td>
            </tr>
          )) : (
            <tr>
              <td className="empty-text" colSpan={5}>No audit logs found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function ReportTable({ columns, downloadable = true, rows, tableClassName = "", title }) {
  const canDownload = downloadable && rows.length > 0;
  const downloadCsv = () => {
    downloadReportCsv({ columns, rows, title });
  };

  return (
    <article className="panel report-table-panel">
      <div className="panel-heading">
        <h3>{title}</h3>
        <div className="report-heading-actions">
          <span>{rows.length} records</span>
          {downloadable ? (
            <button
              className="secondary-button report-download-button"
              disabled={!canDownload}
              onClick={downloadCsv}
              title={canDownload ? "Download report as CSV" : "No records to download"}
              type="button"
            >
              <Download size={16} />
              Download
            </button>
          ) : null}
        </div>
      </div>
      <table className={`data-table ${tableClassName}`.trim()}>
        <thead>
          <tr>
            {columns.map(([, label]) => <th key={label}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={row.id || `${row.employee_id}-${index}`}>
              {columns.map(([key, label, formatter]) => (
                <td key={label}>{formatter ? formatter(row[key]) : displayValue(row[key])}</td>
              ))}
            </tr>
          )) : (
            <tr>
              <td className="empty-text" colSpan={columns.length}>No records found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function EmployeeTable({ employees, mode = "default", onEdit, onSetActive, title }) {
  const hasDefaultActions = mode === "default" && (onEdit || employees.some((employee) => employee.deleted));
  return (
    <article className={title ? "panel" : ""}>
      {title ? (
        <div className="panel-heading">
          <h3>{title}</h3>
          <span>View all</span>
        </div>
      ) : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Department</th>
            <th>Role</th>
            <th>Status</th>
            {hasDefaultActions ? <th>Action</th> : null}
            {mode === "delete" ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {employees.length ? (
            employees.map((employee) => (
              <tr key={employee.id || employee.employee_id}>
                <td>
                  <div className="name-cell">
                    <span className="mini-avatar"><UserRound size={14} /></span>
                    {employee.name}
                  </div>
                </td>
                <td>{employee.employee_id}</td>
                <td>{employee.department}</td>
                <td>{employee.role}</td>
                <td><Badge tone={employee.deleted ? "danger" : "success"}>{employee.deleted ? "Inactive" : "Active"}</Badge></td>
                {hasDefaultActions ? (
                  <td>
                    {employee.deleted && onSetActive ? (
                      <button className="mini-action success-bg" onClick={() => onSetActive(employee.employee_id, true)}>
                        Restore
                      </button>
                    ) : onEdit ? (
                      <button className="mini-action neutral-bg" onClick={() => onEdit(employee)}>
                        Edit
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                ) : null}
                {mode === "delete" ? (
                  <td>
                    <button
                      className={`mini-action ${employee.deleted ? "success-bg" : "danger-bg"}`}
                      onClick={() => onSetActive(employee.employee_id, !!employee.deleted)}
                    >
                      {employee.deleted ? "Restore" : "Deactivate"}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={mode === "delete" || hasDefaultActions ? "6" : "5"} className="empty-text">No employees found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

function Badge({ children, tone }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function leaveStatusTone(status) {
  if (status === "Pending") return "warning";
  if (status === "Revert Requested") return "warning";
  if (status === "Rejected" || status === "Cancelled") return "danger";
  return "success";
}

function leaveFilterTone(status) {
  if (status === "Pending") return "warning";
  if (status === "Approved") return "success";
  if (status === "Rejected") return "danger";
  if (status === "Cancelled") return "neutral";
  if (status === "Revert Requested") return "info";
  return "neutral";
}

function leaveEmployeeName(leave, employeeNameById = new Map()) {
  return displayValue(
    leave.emp_name ||
    leave.name ||
    leave.employee_name ||
    employeeNameById.get(String(leave.employee_id || leave.emp_id || "")),
  );
}

function leaveSubmittedDate(leave) {
  return leave.submitted_on || leave.submitted_at || leave.created_at || leave.updated_at;
}

function leaveDays(leave) {
  if (leave.days !== null && leave.days !== undefined) return Number(leave.days || 0);
  const duration = String(leave.duration || "Full Day").toLowerCase();
  const dayValue = duration.includes("quarter") ? 0.25 : duration.includes("half") ? 0.5 : 1;
  const start = new Date(leave.from_date);
  const end = new Date(leave.to_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dayValue;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.max(Math.round((end - start) / oneDayMs) + 1, 1) * dayValue;
}

function shiftToneColor(name) {
  return {
    Morning: "#f59e0b",
    Evening: "#6366f1",
    Night: "#1e3a5f",
  }[name] || "#2563eb";
}

function sameEmployee(row, employeeId) {
  return String(row?.employee_id || row?.emp_id || "") === String(employeeId || "");
}

function compareEmployeeIds(first, second) {
  const firstId = employeeSortValue(first);
  const secondId = employeeSortValue(second);
  if (typeof firstId === "number" && typeof secondId === "number") return firstId - secondId;
  if (typeof firstId === "number") return -1;
  if (typeof secondId === "number") return 1;
  return String(firstId).localeCompare(String(secondId));
}

function employeeSortValue(row) {
  const rawValue = row?.employee_id || row?.emp_id || "";
  const textValue = String(rawValue).trim();
  return /^\d+$/.test(textValue) ? Number(textValue) : textValue;
}

function attendanceMatchesFilter(row, filter) {
  const status = String(row.status || "Present").toLowerCase().replace("-", " ");
  if (filter === "All") return true;
  if (filter === "Late") return Number(row.late_hours || 0) > 0 || Number(row.late_minutes || 0) > 0;
  if (filter === "Half-Day") return status.includes("half");
  return status === filter.toLowerCase();
}

function attendanceStatusTone(row) {
  const status = String(row.status || "Present").toLowerCase();
  if (status.includes("absent")) return "danger";
  if (status.includes("half") || Number(row.late_hours || 0) > 0 || Number(row.late_minutes || 0) > 0) return "warning";
  return "success";
}

function filterTone(filter) {
  return {
    Present: "success",
    Late: "warning",
    "Half-Day": "info",
    Absent: "danger",
  }[filter] || "neutral";
}

function lateDisplay(row) {
  const lateHours = Number(row.late_hours || 0);
  const lateMinutes = Number(row.late_minutes || 0);
  if (lateHours) return `${lateHours}h`;
  if (lateMinutes) return `${lateMinutes}m`;
  return "-";
}

function timeInputValue(value) {
  if (!value || value === "-") return "";
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value)) return value.padStart(5, "0");
  const normalized =
    typeof value === "string" && value.includes("T") && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function localTimeInput() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function displayDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : value;
}

function formatDateTime(value) {
  if (!value) return "-";
  const normalized =
    typeof value === "string" && value.includes("T") && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return displayValue(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  });
}

function humanizeAction(value) {
  return displayValue(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditTarget(value) {
  const target = displayValue(value);
  if (target === "-") return target;
  return humanizeAction(String(target).split(":")[0]);
}

function auditDetails(details) {
  if (typeof details === "string") return displayValue(details);
  if (!details || typeof details !== "object" || !Object.keys(details).length) return "-";
  return Object.entries(details)
    .map(([key, value]) => `${humanizeAction(key)}: ${displayValue(value)}`)
    .join(" | ");
}

function viewTitle(view) {
  return {
    dashboard: "Dashboard",
    employees: "Employees",
    attendance: "Attendance",
    leaves: "Manage Leaves",
    leave_requests: "Leave Requests",
    add_edit: "Add / Edit Employee",
    delete: "Delete Employee",
    shifts: "Shifts",
    salary_report: "Salary Report",
    monthly_attendance: "Monthly Attendance",
    daily_report: "Daily Report",
    audit_logs: "Audit Logs",
    profile: "Profile",
    reset_password: "Reset Password",
    monthly_report: "Monthly Report",
    my_leaves: "My Leaves",
    request_leave: "Request Leave",
  }[view];
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatTime(value) {
  if (!value) return "-";
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value)) return value;
  const normalized =
    typeof value === "string" && value.includes("T") && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function displayValue(value) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  const missingValues = new Set(["undefined", "null", "n/a", "na", "none", "not provided", "value"]);
  if (!text || missingValues.has(text.toLowerCase())) return "-";
  return text;
}

function readStoredUser() {
  const raw = localStorage.getItem("ems_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("ems_user");
    localStorage.removeItem("ems_token");
    return null;
  }
}

function profileMoney(value) {
  if (displayValue(value) === "-" || Number(value) <= 0) return "-";
  return money(value);
}

function percent(value) {
  if (displayValue(value) === "-") return "-";
  const amount = Number(value);
  if (Number.isNaN(amount)) return displayValue(value);
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2)}%`;
}

function reportCellValue(row, column) {
  const [key, , formatter] = column;
  return formatter ? formatter(row[key]) : displayValue(row[key]);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function filenameFromTitle(title) {
  const slug = String(title || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "report"}.csv`;
}

function downloadReportCsv({ columns, rows, title }) {
  if (!rows.length) return;
  const header = columns.map(([, label]) => escapeCsvCell(label)).join(",");
  const body = rows.map((row) => (
    columns.map((column) => escapeCsvCell(reportCellValue(row, column))).join(",")
  ));
  const csv = [header, ...body].join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameFromTitle(title);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatLeaveNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function summaryValue(summary, label) {
  const wanted = label.toLowerCase().replace("-", " ");
  const entry = Object.entries(summary || {}).find(
    ([key]) => key.toLowerCase().replace("-", " ") === wanted,
  );
  return entry ? entry[1] : 0;
}

function monthYearLabel(month, year) {
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return `${month}/${year}`;
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function localDateISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function tomorrowDateISO() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
    currency: "INR",
  });
}

export default App;
