# Employee Directory

React + TypeScript (Vite) + Axios frontend, Node/Express + PostgreSQL backend.
Features: add / view / edit / delete, search by name, server-side pagination.

## Run locally

### 1. Database
```bash
createdb employee_directory
psql employee_directory -f server/schema.sql
```

### 2. Backend (http://localhost:5000)
```bash
cd server
cp .env.example .env      # set DATABASE_URL
npm install
npm start
```

### 3. Frontend (http://localhost:5173)
```bash
cd client
npm install
npm run dev
```
Optional: set `VITE_API_URL` in `client/.env` if the API is not on port 5000.

## API
| Method | Endpoint | Description |
|---|---|---|
| GET | /employees?search=&page=&limit= | List (filter by name, paginated) -> `{data,total,page,limit}` |
| POST | /employees | Create `{name,email,role}` |
| PUT | /employees/:id | Update |
| DELETE | /employees/:id | Delete |
