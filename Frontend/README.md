# EMS Web Frontend

React + Vite frontend for the EMS web app.

## Local Development

```powershell
npm install
npm run dev
```

The local API URL is configured in `.env`:

```text
VITE_API_BASE_URL=http://localhost:8000
```

## Production Build

```powershell
npm run build
```

Deploy the generated `dist` folder.

## Production Environment

Use `Frontend/.env.production.example` as the checklist for your frontend host:

```text
VITE_API_BASE_URL=https://your-backend-domain.com
```

Before publishing, run the guarded production build:

```powershell
npm run build:production
```

This fails if `VITE_API_BASE_URL` is missing, uses `http`, points to localhost, or still contains the example backend domain.

The backend must include this frontend domain in `CORS_ALLOWED_ORIGINS`, or login and protected API requests will fail.
