# todoplusplus-UI-app

Simple React (JavaScript) frontend for `todoplusplus-core-service`.

## Features
- Landing login page at `/`
- Todo homepage at `/todos` with title **ToDo ++**
- Shows BaseRock logo on all pages
- Login/logout action on top-right
- Default credentials shown on login page for admin/user
- Todo input textarea:
  - `Enter` submits
  - `Shift+Enter` adds newline
- Todo table with left-side actions per row:
  - `✓` mark done (`completed=true`)
  - `✕` delete (admin deletes directly; user creates approval request)

## Quick Start
1. Go to the UI project:
```bash
cd todoplusplus-UI-app
```

2. Configure backend URL:
```bash
cp .env.example .env
```

3. Install dependencies:
```bash
npm install
```

4. Run development server:
```bash
npm run dev
```

UI runs on `http://localhost:5174`.

## Connect to This ToDoPlusPlus Backend
- Keep backend running at `http://localhost:8081`
- Set in `.env`:
```env
VITE_API_BASE_URL=http://localhost:8081
```

## Connect to Any Other ToDo Backend in Future
This UI expects these endpoints:
- `POST /auth/login` -> `{ access_token, user }`
- `GET /auth/me` -> `{ id, username, role }`
- `GET /todos` -> `[{ id, name, completed }]`
- `POST /todos` -> create todo with `{ name, completed }`
- `PUT /todos/{id}` -> update fields, especially `completed`
- `DELETE /todos/{id}` -> delete response with `action` and `message`

If another backend uses different paths/fields, only update:
- `src/services/api.js` for base URL/interceptors
- `src/pages/LoginPage.jsx` and `src/pages/TodoPage.jsx` for response mapping

## Notes
- A local vector logo is included at `public/baserock-logo.svg`.
- If you want to use your exact PNG logo file, replace this file and keep the same filename.
