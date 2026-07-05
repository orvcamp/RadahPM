# RADAH PM Platform — Phase 1

A multi-role project management platform for RADAH: Admin/Staff, Client/Owner,
and Trade Partner logins, centered on project and schedule tracking.

## What's included (Phase 1)

- Real authentication (JWT, bcrypt-hashed passwords)
- Three roles with enforced (backend, not just UI) permissions:
  - **Admin / Staff** — full visibility and control over all projects
  - **Client / Owner** — sees only their own projects, read-only on tasks
  - **Trade Partner** — sees only tasks assigned to them, can update their own task status
- Projects, Phases, Tasks/Milestones, task comments, project team membership
- Gantt-style timeline view per project
- Admin can create projects, add phases, invite/add users, assign tasks

## What's NOT included yet (planned for Phase 2/3)

Budgets & costs, change orders, RFIs/submittals, daily logs, document
storage, notifications/email, reporting/exports. The schema (see
`backend/db/schema.sql`) is intentionally structured so these bolt on as
new tables referencing `projects(id)`, following the same pattern as `tasks`.

## Stack

- **Backend:** Node.js, Express, PostgreSQL (`pg`), JWT auth, bcrypt
- **Frontend:** React + Vite, React Router (no UI framework dependency)
- **Hosting:** Railway (backend + Postgres) and Vercel (frontend) — see below

---

## Deploying — step by step

### 1. Push this code to GitHub

Railway and Vercel both deploy from a Git repo. Create a new GitHub repo and
push the `radah-pm` folder (both `backend/` and `frontend/`) to it.

```bash
cd radah-pm
git init
git add .
git commit -m "Initial commit — RADAH PM Phase 1"
git branch -M main
git remote add origin <your-new-repo-url>
git push -u origin main
```

### 2. Deploy the backend + database on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → select your repo.
3. When asked for the root directory, set it to `backend`.
4. **Add a database:** in the same Railway project, click **+ New → Database → PostgreSQL**.
   Railway automatically creates a `DATABASE_URL` variable and makes it available
   to your backend service — you don't need to copy/paste a connection string manually,
   but double check the backend service's **Variables** tab has `DATABASE_URL` referenced
   (Railway usually wires this automatically when both services are in the same project).
5. On your **backend service → Variables**, add:
   ```
   JWT_SECRET=<run: openssl rand -base64 48>
   CORS_ORIGIN=https://your-frontend-domain.vercel.app
   NODE_ENV=production
   ADMIN_EMAIL=admin@radahpm.com
   ADMIN_PASSWORD=<choose a strong password>
   ADMIN_NAME=RADAH Admin
   ```
   (You'll update `CORS_ORIGIN` once you have the real Vercel URL in step 3 — it's fine
   to redeploy after setting it.)
6. Railway will build and start the service automatically using `backend/railway.json`,
   which runs `npm run setup` (creates tables + seeds the first admin user) and then
   `npm start` on every deploy. This is safe to run repeatedly.
7. Once deployed, click the backend service → **Settings → Networking → Generate Domain**
   to get a public URL like `https://radah-pm-backend.up.railway.app`. Test it:
   ```
   https://radah-pm-backend.up.railway.app/api/health
   ```
   You should see `{"status":"ok", ...}`.

### 3. Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New Project** → select your repo.
3. Set **Root Directory** to `frontend`.
4. Framework preset should auto-detect as **Vite**.
5. Add an environment variable:
   ```
   VITE_API_URL=https://radah-pm-backend.up.railway.app/api
   ```
   (use your actual Railway backend URL + `/api`)
6. Deploy. Vercel will give you a URL like `https://radah-pm.vercel.app`.
7. Go back to Railway and update the backend's `CORS_ORIGIN` variable to this exact
   Vercel URL, then redeploy the backend so it accepts requests from your frontend.

### 4. First login

Go to your Vercel URL and log in with the admin credentials you set in
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. **Change this password immediately** via
Settings once logged in.

From there, as admin you can:
- Create your first project (Projects → + New Project)
- Add clients/trade partners as users (Users → + Add User) — this generates
  a temporary password to share with them securely
- Add those users to a project's **Team** tab so they can see it
- Add phases and tasks, assign tasks to trade partners

---

## Local development (optional)

If you want to run this locally before/instead of deploying:

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
# edit .env with a local Postgres connection string and a JWT secret
npm run setup   # creates tables + seed admin user
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Visit `http://localhost:5173`.

---

## Smoke-test checklist after deploying

Run through this after every deploy to confirm things actually work — this
hasn't been tested in a live browser/database in the environment this was
built in, so treat this checklist as required, not optional:

- [ ] `GET /api/health` on the backend URL returns `{"status":"ok"}`
- [ ] Can log in as admin with the seeded credentials
- [ ] Admin can create a new project
- [ ] Admin can add a phase to the project
- [ ] Admin can create a task, assign a due date, and see it on the Timeline tab
- [ ] Admin can add a new user (client role) — temporary password is shown
- [ ] Admin can add that client to the new project's Team tab
- [ ] Log out, log in as the client — confirm they see *only* that one project
- [ ] As client, confirm tasks are visible but the status dropdown is **not** editable
- [ ] Add a trade partner user, assign them a task, confirm they see *only* that task
- [ ] As trade partner, confirm they **can** change their own task's status
- [ ] As trade partner, confirm they **cannot** edit task title/dates/assignment

If any of these fail, check the Railway backend logs first (most issues will
be a missing environment variable or a CORS mismatch).

---

## Security notes

- Change the seeded admin password immediately after first login.
- `JWT_SECRET` must be a long random value — never reuse the example in `.env.example`.
- Temporary passwords generated for new users (via Users → + Add User, or
  Users → Reset Password) are only shown once in the UI — copy them
  immediately and share through a secure channel, since there is no
  password-reset email flow in Phase 1.
