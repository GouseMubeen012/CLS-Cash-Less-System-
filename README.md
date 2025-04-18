# CLS - Cash-Less System

This project is a full-stack cashless transaction management system for educational institutions or stores. It includes a backend (Node.js/Express), two frontends (admin and store/staff), and is fully dockerized for easy deployment.

---

## Features
- Student registration and management
- Store registration and management
- QR code-based student identification
- Transaction processing and daily statistics
- Settlement management for stores
- Real-time updates using WebSockets
- Admin and store/staff dashboards
- Fully dockerized setup for production or local development

---

## Project Structure

- `backend/` : Node.js/Express backend API, database migrations, and uploads
- `frontend/` : React admin dashboard (for students, stores, analytics, settlements)
- `store-frontend/` : React dashboard for store/staff (QR scanning, transactions, settlements)
- `docker-compose.yml` : Multi-service orchestration for backend, frontends, and database
- `.gitignore` : Ensures node_modules and build artifacts are not tracked

---

## Quick Start (Docker)

1. **Clone the repository:**
   ```sh
   git clone https://github.com/GouseMubeen012/CLS-Cash-Less-System-.git
   cd CLS-Cash-Less-System-
   ```
2. **Configure environment variables:**
   - Edit `backend/.env` for your Postgres DB credentials and secrets.
3. **Build and run with Docker Compose:**
   ```sh
   docker-compose build
   docker-compose up -d
   ```

4. **Initialize the database (Required!):**
   > **Important:** After starting the containers for the first time on a new machine or database, you MUST run the migrations script to set up the database schema. Without this, your backend will not function correctly (no tables will exist).
   ```sh
   docker-compose exec backend node src/db/migrations.js
   ```

5. **Access the app:**
   - Admin UI: http://localhost:3000
   - Store UI: http://localhost:4000
   - Backend API: http://localhost:5000

---

## Manual Setup (Without Docker)

### Backend
```sh
cd backend
npm install
# Configure backend/.env
cd src/db
node migrations.js
cd ../..
npm start
```

### Frontend
```sh
cd frontend
npm install
npm start  # or npm run build
```

### Store Frontend
```sh
cd store-frontend
npm install
npm start  # or npm run build
```

---

## Author
MOHAMMED GOUSE MUBEEN
https://github.com/GouseMubeen012
