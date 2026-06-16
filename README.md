# Whispr - Backend API

The backend API for **Whispr**, a modern real-time chat application. This service is built with [Fastify](https://www.fastify.io/) and [TypeScript](https://www.typescriptlang.org/), providing a lightweight, fast, and robust foundation for chat operations.

---

## 🚀 Technology Stack

- **Framework:** [Fastify (v4)](https://www.fastify.io/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Development Tooling:** [tsx](https://github.com/privatenumber/tsx) for fast, hot-reloading execution
- **Configuration:** Clean process-level environment variable configuration

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)

### Installation

Navigate to the backend directory and install dependencies:

```bash
cd Whispr-BE
npm install
```

### Running Development Server

Start the development server with hot-reloading enabled:

```bash
npm run dev
```

The server will start on `http://localhost:3001` (by default) or the custom `PORT` defined in your environment variables.

### Build & Production Execution

To build the TypeScript files to production-ready JavaScript:

```bash
npm run build
```

The compiled code will be output to the `/dist` directory. You can start the server in production mode using:

```bash
npm run start
```

### 🗄️ Database Setup & ORM (Prisma)

This project uses **Prisma ORM** for database mapping, type-safe queries, and relation management.

1. Copy `.env.example` to create `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your actual Supabase PostgreSQL connection string as `SUPABASE_DB_URL` and a secure secret for `JWT_SECRET`.
3. Introspect and sync the schema from your active database:
   ```bash
   npx prisma db pull
   ```
4. Generate the local Prisma Client:
   ```bash
   npx prisma generate
   ```
5. Push schema updates directly (if changes are made to `schema.prisma`):
   ```bash
   npm run db:migrate
   ```
   *(This runs `prisma db push` under the hood).*

---

## 🔌 API Endpoints

### 1. Root Greeting
- **Endpoint:** `GET /`
- **Description:** Verifies that the API service is active and running.
- **Response Format:**
  ```json
  {
    "message": "Welcome to Whispr Chat Application API",
    "status": "active"
  }
  ```

### 2. Health Check
- **Endpoint:** `GET /health`
- **Description:** Returns the status, uptime of the node process, and current server timestamp.
- **Response Format:**
  ```json
  {
    "status": "ok",
    "uptime": 12.345,
    "timestamp": "2026-06-07T11:28:44.000Z"
  }
  ```

### 3. User Authentication
All authentication endpoints reside under the `/api/auth` prefix and use secure HTTP-only session cookies.

- **Register:** `POST /api/auth/register`
  - *Payload:* `{"email": "...", "password": "...", "name": "...", "contact_no": "...", "avatar_url": "..."}`
  - *Response:* `201 Created` with user profile JSON. Sets `token` cookie.
- **Login:** `POST /api/auth/login`
  - *Payload:* `{"email": "...", "password": "..."}`
  - *Response:* `200 OK` with user profile JSON. Sets `token` cookie.
- **Logout:** `POST /api/auth/logout`
  - *Payload:* None
  - *Response:* `200 OK` and clears the `token` cookie.
- **Get Profile:** `GET /api/auth/me` (Protected)
  - *Payload:* None (Requires valid `token` cookie)
  - *Response:* `200 OK` with active profile JSON.
- **Update Profile:** `PUT /api/auth/me` (Protected)
  - *Payload:* `{"name": "...", "contact_no": "...", "avatar_url": "..."}` (name is required, other fields optional)
  - *Response:* `200 OK` with `{ "message": "Profile updated successfully", "user": { ... } }`.
- **Check User Email:** `GET /api/auth/check/:email` (Protected)
  - *Description:* Validates whether a user exists by email, retrieving their public details.
  - *Response:* `200 OK` with `{ "exists": true, "profile": { "id": "...", "name": "...", "email": "...", "avatar_url": "..." } }` if found; `404 Not Found` with `{ "exists": false, "message": "..." }` otherwise.
- **Delete Account:** `DELETE /api/auth/me` (Protected)
  - *Payload:* None (Requires valid `token` cookie)
  - *Response:* `200 OK` on successful account deletion (removes profile, status, room memberships, nullifies message sender IDs, and clears cookie).

### 4. Room Management
All room management endpoints reside under the `/api/rooms` prefix and require JWT authentication via the `token` cookie.

- **Create Room:** `POST /api/rooms` (Protected)
  - *Payload (Direct Message):* `{"is_group": false, "email": "otheruser@example.com", "name": "Optional Custom Name"}`
  - *Payload (Group Chat):* `{"is_group": true, "name": "Group Name", "email": ["member1@example.com", "member2@example.com"]}` (can also pass a single email string)
  - *Response:* `201 Created` (or `200 OK` if reusing an existing DM room) with the room object including members.
- **List Rooms:** `GET /api/rooms` (Protected)
  - *Response:* `200 OK` with `{ "rooms": [...] }` containing all rooms the user is a member of.
- **Get Room Details:** `GET /api/rooms/:id` (Protected)
  - *Response:* `200 OK` with details of the specific room.
- **Update Room Name:** `PATCH /api/rooms/:id` (Protected)
  - *Payload:* `{"name": "New Group Name"}`
  - *Permission:* Only `owner` or `admin` of the group room can rename it. Direct Message rooms cannot be renamed.
  - *Response:* `200 OK` with the updated room.
- **Delete Room:** `DELETE /api/rooms/:id` (Protected)
  - *Permission:* Only `owner` of the group room can delete it. Direct Message rooms cannot be deleted.
  - *Response:* `200 OK` with a success message.
- **Add Room Members:** `POST /api/rooms/:id/members` (Protected)
  - *Payload:* `{"userIds": ["uuid-1", "uuid-2"]}`
  - *Permission:* Only `owner` or `admin` of the group room can add members.
  - *Response:* `200 OK` with the updated room details.
- **Remove Member / Leave Room:** `DELETE /api/rooms/:id/members/:userId` (Protected)
  - *Description:* Allows leaving a room or removing a member.
    - **DM Room:** A user can only leave (their own `userId` must be passed).
    - **Group Room:** A member can leave. If the `owner` leaves and other members remain, ownership is automatically transferred to the oldest admin, or the oldest member if no admins exist. Alternatively, an `owner` or `admin` can remove other members (admins cannot remove owners or other admins).
    - If a room is left with no remaining members, it is deleted automatically.
  - *Response:* `200 OK` with message.

---

## ⚙️ Configuration & Environment Variables

You can customize the server behavior using environment variables:

| Variable | Description | Default Value |
|:---|:---|:---|
| `PORT` | The port number on which the Fastify server listens | `3001` |
| `HOST` | The network interface host | `0.0.0.0` |
| `SUPABASE_DB_URL` | The PostgreSQL URI for Supabase database connection | *Required* |
| `JWT_SECRET` | Secret key used to sign and verify JWT session tokens | *Required* |

---

## 📁 Project Structure

```
Whispr-BE/
├── prisma/               # Prisma ORM configuration and schemas
│   └── schema.prisma     # Database schema models and database mappings
├── dist/                 # Compiled JavaScript files (after npm run build)
├── node_modules/         # Node dependencies
├── src/
│   ├── routes/           # Fastify route plugins
│   │   ├── auth.ts       # Authentication endpoints (Register, Login, Logout, Me, Delete)
│   │   ├── health.ts     # Health-check route definitions
│   │   ├── rooms.ts      # Room management endpoints (Create, List, Details, Members)
│   │   └── root.ts       # Root welcome endpoint
│   ├── app.ts            # Fastify app configuration (Cookie, JWT, CORS, Routing)
│   ├── db.ts             # Prisma Client client instantiation
│   └── server.ts         # Server entrypoint (loads dotenv and starts logger/listener)
├── tsconfig.json         # TypeScript configuration
├── package.json          # Node project scripts & dependencies
├── .env.example          # Template for environment variables configuration
└── .gitignore            # Root Git ignore configuration
```

---

## 🪵 Logger Configuration

The backend features a customized logger setup via Fastify's built-in Pino logger, configured to:
- Output timestamps converted to **Indian Standard Time (IST, UTC+5:30)** for easy debugging in your development environment.
- Format custom output fields including `req` (method and URL) and `res` (statusCode).
- Automatically format response times in seconds (e.g., `0.1 s`).
- Redact request IDs for clean, readable console output.
