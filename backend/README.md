# EMS Web Backend

Separate FastAPI backend for the EMS web app. It does not modify or depend on the older PyQt desktop EMS project.

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

The API will run at `http://localhost:8000`.

Interactive docs:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`

## Default Admin

On startup, the backend creates one admin if no admin exists. Configure it in `.env`:

```text
ADMIN_EMPLOYEE_ID=777
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

Change these values before production.

## Production Environment

Use `backend/.env.production.example` as the checklist for your backend host. Do not upload a real `.env` file to GitHub.

Required production settings:

```text
APP_ENV=production
MONGO_URI=mongodb+srv://...
MONGO_DB_NAME=employee_attendance
JWT_SECRET_KEY=<new long random secret>
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
COOKIE_SECURE=true
COOKIE_SAMESITE=none
ADMIN_PASSWORD=<strong admin password>
```

For separate frontend/backend domains, `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` are required or the browser will not send the login cookie on API requests.

Backend start command for most hosts:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Deployment files are included:

- `Procfile` for hosts that run Procfile web processes.
- `render.yaml` for Render Blueprint deployments from the repository root.

## Main API Groups

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/employees`
- `POST /api/v1/employees`
- `PATCH /api/v1/employees/{employee_id}`
- `DELETE /api/v1/employees/{employee_id}`
- `POST /api/v1/attendance/check-in`
- `POST /api/v1/attendance/check-out`
- `GET /api/v1/attendance`
- `PUT /api/v1/attendance/manual`
- `GET /api/v1/shifts`
- `POST /api/v1/shifts/assignments`
- `GET /api/v1/leaves`
- `POST /api/v1/leaves`
- `PATCH /api/v1/leaves/{leave_id}/review`

Use the bearer token returned by login for protected routes.
