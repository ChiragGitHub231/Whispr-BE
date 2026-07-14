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
  - _Payload:_ `{"email": "...", "password": "...", "name": "...", "contact_no": "...", "avatar_url": "..."}`
  - _Response:_ `201 Created` with user profile JSON (including default privacy settings: `show_status: true`, `read_receipts: true`). Sets `token` cookie.
- **Login:** `POST /api/auth/login`
  - _Payload:_ `{"email": "...", "password": "..."}`
  - _Response:_ `200 OK` with user profile JSON (including privacy settings: `show_status`, `read_receipts`). Sets `token` cookie.
- **Logout:** `POST /api/auth/logout`
  - _Payload:_ None
  - _Response:_ `200 OK` and clears the `token` cookie.
- **Get Profile:** `GET /api/auth/me` (Protected)
  - _Payload:_ None (Requires valid `token` cookie)
  - _Response:_ `200 OK` with active profile JSON (including privacy settings: `show_status`, `read_receipts`).
- **Update Profile:** `PUT /api/auth/me` (Protected)
  - _Payload:_ `{"name": "...", "contact_no": "...", "avatar_url": "...", "show_status": true/false, "read_receipts": true/false}` (name is required, other fields optional)
  - _Behavior:_ Supports raw Base64 data URLs for `avatar_url` (e.g. `data:image/png;base64,...`). If provided, converts and uploads it to the Supabase storage bucket `whispr_assets_storage` under the virtual path `profile_avatar/{userId}_{timestamp}.{extension}` and cleans up any old avatar. Updates user-defined privacy options in the database; changing `show_status` triggers presence broadcasts.
  - _Response:_ `200 OK` with `{ "message": "Profile updated successfully", "user": { ... } }`.
- **Check User Email:** `GET /api/auth/check/:email` (Protected)
  - _Description:_ Validates whether a user exists by email, retrieving their public details.
  - _Response:_ `200 OK` with `{ "exists": true, "profile": { "id": "...", "name": "...", "email": "...", "avatar_url": "..." } }` if found; `404 Not Found` with `{ "exists": false, "message": "..." }` otherwise.
- **Delete Account:** `DELETE /api/auth/me` (Protected)
  - _Payload:_ None (Requires valid `token` cookie)
  - _Response:_ `200 OK` on successful account deletion (removes profile, status, room memberships, nullifies message sender IDs, and clears cookie).

### 4. Room Management

All room management endpoints reside under the `/api/rooms` prefix and require JWT authentication via the `token` cookie.

- **Create Room:** `POST /api/rooms` (Protected)
  - _Payload (Direct Message):_ `{"is_group": false, "email": "otheruser@example.com", "name": "Optional Custom Name"}`
  - _Payload (Group Chat):_ `{"is_group": true, "name": "Group Name", "email": ["member1@example.com", "member2@example.com"]}` (can also pass a single email string)
  - _Response:_ `201 Created` (or `200 OK` if reusing an existing DM room) with the room object including members.
- **List Rooms:** `GET /api/rooms` (Protected)
  - _Response:_ `200 OK` with `{ "rooms": [...] }` containing all rooms the user is a member of. Each room member details are populated with online presence status (`user_status`: `is_online` and `last_seen`), and each room contains a snippet of its last message (`text` and `file_url`).
- **Get Room Details:** `GET /api/rooms/:id` (Protected)
  - _Response:_ `200 OK` with details of the specific room.
- **Update Room Name:** `PATCH /api/rooms/:id` (Protected)
  - _Payload:_ `{"name": "New Group Name"}`
  - _Permission:_ Only `owner` or `admin` of the group room can rename it. Direct Message rooms cannot be renamed.
  - _Response:_ `200 OK` with the updated room.
- **Delete Room:** `DELETE /api/rooms/:id` (Protected)
  - _Permission:_ Only `owner` of the group room can delete it. Direct Message rooms cannot be deleted.
  - _Response:_ `200 OK` with a success message.
- **Add Room Members:** `POST /api/rooms/:id/members` (Protected)
  - _Payload:_ `{"userIds": ["uuid-1", "uuid-2"]}`
  - _Permission:_ Only `owner` or `admin` of the group room can add members.
  - _Response:_ `200 OK` with the updated room details.
- **Remove Member / Leave Room:** `DELETE /api/rooms/:id/members/:userId` (Protected)
  - _Description:_ Allows leaving a room or removing a member.
    - **DM Room:** A user can only leave (their own `userId` must be passed).
    - **Group Room:** A member can leave. If the `owner` leaves and other members remain, ownership is automatically transferred to the oldest admin, or the oldest member if no admins exist. Alternatively, an `owner` or `admin` can remove other members (admins cannot remove owners or other admins).
    - If a room is left with no remaining members, it is deleted automatically.
  - _Response:_ `200 OK` with message.

### 5. Messaging & Realtime Events

Message endpoints are protected and support the chat UI's realtime behavior.

- **Fetch Room Messages:** `GET /api/messages/:roomId` (Protected)
  - _Query Parameters:_
    - `limit` (optional): The max number of messages to fetch (default: `30`).
    - `before` (optional): ISO timestamp cursor. Fetches messages sent before this date.
  - _Behavior:_ Returns messages in reverse chronological order and marks all unread messages from other users in the room as `read`.
  - _Response:_ `200 OK` with `{ "messages": [...], "hasMore": true/false }` (reordered chronologically for presentation).
- **Send Message:** `POST /api/messages/:roomId` (Protected)
  - _Payload:_ `{"text": "Hello", "file_url": "optional-url"}`
  - _Behavior:_ Saves the message and broadcasts it to all active clients in the room via WebSocket (`message:new` event).
  - _Response:_ `201 Created` with the created message payload.
- **Upload Message Attachment:** `POST /api/messages/:roomId/upload` (Protected)
  - _Payload:_ `{"file_data_url": "data:mime/type;base64,...", "original_name": "filename.ext"}`
  - _Behavior:_ Enforces a 50MB file size limit. Converts and uploads the Base64 attachment to the Supabase storage bucket `whispr_assets_storage` under virtual directory paths segmented by media type (`images/`, `videos/`, `audio/`, `documents/`, or `files/`).
  - _Response:_ `200 OK` with `{ "file_url": "https://..." }`.
- **Delete Message:** `DELETE /api/messages/:messageId` (Protected)
  - _Behavior:_ Soft deletes a message by clearing its `text` content, setting `file_url` to null, and setting status to `'deleted'`. It also purges any associated attachment from the Supabase storage bucket. Emits a `message:delete` event to WebSocket clients.
  - _Response:_ `200 OK` with `{ "message": "Message deleted successfully." }`.
- **Clear Chat History:** `DELETE /api/messages/room/:roomId/clear` (Protected)
  - _Behavior:_ Deletes all messages in the room from the database. Purges all associated message attachments from the Supabase storage bucket. Generates a senderless system message (e.g. *"Chat history cleared by Alice"*) and broadcasts a `message:clear` event to WebSocket clients.
  - _Response:_ `200 OK` with `{ "message": "Chat cleared successfully.", "systemMessage": { ... } }`.
- **Realtime WebSocket:** `GET /ws` (Protected via JWT cookie)
  - _Description:_ Real-time connection utilizing `@fastify/websocket`. Connects clients and maps them to room sub-channels.
  - _Events emitted by server to clients:_
    - `message:new`: Broadcasts newly created messages.
    - `message:read`: Broadcasts updated read receipts.
    - `typing:update`: Broadcasts typing indicators for users (`isTyping: true/false`).
    - `presence:update`: Broadcasts online/offline status changes of users. (Only emitted if the user's `show_status` privacy setting is enabled).
    - `user:status-setting:update`: Broadcasts when a user updates their `show_status` privacy toggle.
    - `message:delete`: Broadcasts when a message has been deleted.
    - `message:clear`: Broadcasts when chat history has been cleared.
  - _Events received by server from clients:_
    - `typing`: Sends typing indicator payload to broadcast to the room.
    - `typing-stop`: Sends typing stopped payload.
    - `message:read`: Receives message IDs that were read by the user to mark them as `read` in the database and broadcast read receipts.

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
