# Whispr - Backend API

The backend API for **Whispr**, a modern real-time chat application. This service is built with [Fastify](https://www.fastify.io/) and [TypeScript](https://www.typescriptlang.org/), providing a lightweight, fast, and robust foundation for chat operations, including realtime messaging, read receipts, typing indicators, and online presence updates.

---

## 🚀 Technology Stack

- **Framework:** [Fastify (v4)](https://www.fastify.io/)
- **Realtime Transport:** [@fastify/websocket](https://github.com/fastify/fastify-websocket) for live chat events
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Database ORM:** [Prisma](https://www.prisma.io/)
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
   _(This runs `prisma db push` under the hood)._

---

## 🔌 API Endpoints

All endpoints except public check/health/root endpoints are protected and require JWT authentication via the secure `token` cookie.

### 1. System & Utility Endpoints

| Endpoint | Method | Auth | Payload | Description & Response |
| :--- | :--- | :---: | :--- | :--- |
| `/` | `GET` | ❌ | None | Verifies that the API service is active. Returns `200 OK` with a welcome message: `{"message": "Welcome to Whispr Chat Application API", "status": "active"}`. |
| `/health` | `GET` | ❌ | None | Returns the status, process uptime in seconds, and server timestamp. Returns `200 OK` with health status. |

### 2. User Authentication (`/api/auth`)

| Endpoint | Method | Auth | Payload | Description & Response |
| :--- | :--- | :---: | :--- | :--- |
| `/api/auth/register` | `POST` | ❌ | `{"email": "...", "password": "...", "name": "...", "contact_no": "...", "avatar_url": "..."}` | Registers user with default privacy settings (`show_status: true`, `read_receipts: true`). Sets `token` cookie. Returns `201 Created` with user profile. |
| `/api/auth/login` | `POST` | ❌ | `{"email": "...", "password": "..."}` | Authenticates user. Sets `token` cookie. Returns `200 OK` with user profile. |
| `/api/auth/logout` | `POST` | 🔒 | None | Clears the `token` cookie. Returns `200 OK`. |
| `/api/auth/me` | `GET` | 🔒 | None | Retrieves profile and privacy details of the logged-in user. Returns `200 OK` with active profile. |
| `/api/auth/me` | `PUT` | 🔒 | `{"name": "...", "contact_no": "...", "avatar_url": "...", "show_status": bool, "read_receipts": bool}` | Updates profile. Supports Base64 `avatar_url` (uploads to Supabase `whispr_assets_storage`, deletes old avatar). Returns `200 OK` with updated user. |
| `/api/auth/check/:email` | `GET` | 🔒 | None | Validates if a user exists by email, retrieving public profile. Returns `200 OK` with profile or `404 Not Found`. |
| `/api/auth/me` | `DELETE` | 🔒 | None | Deletes user account and associated memberships/status. Clears cookie. Returns `200 OK`. |

### 3. Room Management (`/api/rooms`)

| Endpoint | Method | Auth | Payload | Description & Response |
| :--- | :--- | :---: | :--- | :--- |
| `/api/rooms` | `POST` | 🔒 | **DM:** `{"is_group": false, "email": "...", "name": "..."}`<br>**Group:** `{"is_group": true, "name": "...", "email": [...]}` | Creates a room (DMs reuse existing rooms). Returns `201 Created` (or `200 OK` for reused DM) with room details. |
| `/api/rooms` | `GET` | 🔒 | None | Lists all rooms the user is in, populated with last messages and member online presence status (`is_online`, `last_seen`). Returns `200 OK`. |
| `/api/rooms/:id` | `GET` | 🔒 | None | Retrieves details for a specific room. Returns `200 OK`. |
| `/api/rooms/:id` | `PATCH` | 🔒 | `{"name": "..."}` | Updates group room name. Only room owner or admin can update. DM rooms cannot be renamed. Returns `200 OK`. |
| `/api/rooms/:id` | `DELETE` | 🔒 | None | Deletes group room. Only owner can delete. DM rooms cannot be deleted. Returns `200 OK`. |
| `/api/rooms/:id/members` | `POST` | 🔒 | `{"userIds": ["uuid-1", "uuid-2"]}` | Adds members to a group room. Only owner or admin can add. Returns `200 OK`. |
| `/api/rooms/:id/members/:userId` | `DELETE` | 🔒 | None | Leave room or remove member. DM allows leaving. Group transfers ownership to oldest admin/member on owner departure. Returns `200 OK`. |

### 4. Messaging & Media (`/api/messages` & `/api/media`)

| Endpoint | Method | Auth | Payload / Query Params | Description & Response |
| :--- | :--- | :---: | :--- | :--- |
| `/api/media` | `GET` | 🔒 | None | Fetches all shared media/attachments (`file_url` not null) across all rooms the user has joined. Returns `200 OK`. |
| `/api/messages/:roomId` | `GET` | 🔒 | *Query:* `limit` (default `30`), `before` (ISO timestamp) | Fetches room messages chronologically. Marks other users' messages in the room as read. Returns `200 OK` with messages list. |
| `/api/messages/:roomId` | `POST` | 🔒 | `{"text": "...", "file_url": "..."}` | Sends a text/file message. Broadcasts `message:new` event to WebSocket clients. Returns `201 Created`. |
| `/api/messages/:roomId/upload` | `POST` | 🔒 | `{"file_data_url": "data:...", "original_name": "..."}` | Uploads a Base64 attachment (up to 50MB) to Supabase storage by media type. Returns `200 OK` with `{ "file_url": "..." }`. |
| `/api/messages/:messageId` | `DELETE` | 🔒 | None | Soft deletes message (clears text, sets status to `deleted`), purges attachment, and broadcasts `message:delete`. Returns `200 OK`. |
| `/api/messages/room/:roomId/clear` | `DELETE` | 🔒 | None | Clears chat history, purges room attachments from Supabase, generates system message, and broadcasts `message:clear`. Returns `200 OK`. |

### 5. Realtime WebSockets (`/ws`)

| Endpoint | Method | Auth | Description |
| :--- | :--- | :---: | :--- |
| `/ws` | `GET` | 🔒 | Establishes a WebSocket connection using `@fastify/websocket` for real-time room communication. |

#### 📤 WebSocket: Server to Client Events

| Event Name | Description | Payload Example / Notes |
| :--- | :--- | :--- |
| `message:new` | Broadcasts newly created messages to active room clients. | Full message object JSON |
| `message:read` | Broadcasts updated read receipts when a user reads messages. | Read status and message IDs details |
| `typing:update` | Broadcasts typing indicators for users. | `{"userId": "...", "roomId": "...", "isTyping": true/false}` |
| `presence:update` | Broadcasts online/offline status changes. | `{"userId": "...", "status": "online"/"offline", "last_seen": "..."}` (if user has enabled `show_status`) |
| `user:status-setting:update`| Broadcasts when a user updates their `show_status` privacy toggle. | `{"userId": "...", "show_status": true/false}` |
| `message:delete` | Broadcasts when a message has been soft deleted. | `{"messageId": "..."}` |
| `message:clear` | Broadcasts when a room's chat history has been cleared. | `{"roomId": "...", "systemMessage": { ... }}` |

#### 📥 WebSocket: Client to Server Events

| Event Name | Description | Payload Example |
| :--- | :--- | :--- |
| `typing` | Notifies that the client has started typing. | `{"roomId": "..."}` |
| `typing-stop` | Notifies that the client has stopped typing. | `{"roomId": "..."}` |
| `message:read` | Sends list of message IDs read by the user to update the database. | `{"roomId": "...", "messageIds": [...]}` |

---

## ⚙️ Configuration & Environment Variables

You can customize the server behavior using environment variables:

| Variable                     | Description                                                   | Default Value |
| :--------------------------- | :------------------------------------------------------------ | :------------ |
| `PORT`                       | The port number on which the Fastify server listens           | `3001`        |
| `HOST`                       | The network interface host                                    | `0.0.0.0`     |
| `SUPABASE_DB_URL`            | The PostgreSQL URI for Supabase database connection           | _Required_    |
| `JWT_SECRET`                 | Secret key used to sign and verify JWT session tokens         | _Required_    |
| `SUPABASE_URL`               | The public Supabase project URL (needed for storage upload)   | _Required_    |
| `SUPABASE_SERVICE_ROLE_KEY`  | Service role key for authenticating admin storage operations  | _Required_    |
| `SUPABASE_ANON_KEY`          | Alternative anonymous API key for storage uploads            | _Optional_    |

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
│   │   ├── messages.ts   # Message fetch/send endpoints + websocket realtime handler
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
