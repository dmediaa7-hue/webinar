# Webinar - Video Conferencing Platform

A web-based video conferencing application inspired by Zoom, built with React +
simple-peer **P2P WebRTC** on the frontend and Node.js + Express + Socket.io on
the backend. No external media servers — all audio/video/screen traffic flows
peer-to-peer between browsers; the server only relays signaling and non-media state.

## Features

**Media (P2P WebRTC)**
- **HD video & audio calls** — direct peer-to-peer mesh between browsers (simple-peer)
- **Screen sharing** — share your entire screen or a specific window
- **Pre-join lobby** — camera preview + device picker before publishing

**Collaboration**
- **Real-time chat** — messages with typing indicators
- **Reactions & emoji** — transient overlay bursts on participant tiles
- **Polls & Q&A** — host-created polls with live results; Q&A with upvotes and host-mark-answered (persisted to SQLite)
- **Whiteboard** — shared Excalidraw canvas, delta-synced (persisted to SQLite)

**Meetings & scheduling**
- **Meeting scheduling** — create future meetings (title, start time, duration, passcode, waiting room); ICS download + Google Calendar "Add to Calendar" link
- **Start/Join** — Start materializes the live room; guests join via invite link; expired meetings show "meeting has ended"

**Moderation & safety**
- **Participant management** — live participant list, host mute/kick, host transfer
- **Host controls** — room locking, waiting room with admit/deny, force-mute
- **Waiting room** — joiners are held until the host admits them
- **Breakout rooms** — host provisions labeled groups; assignments broadcast over the collab relay (media stays peer-to-peer)

**Accounts & recording**
- **Real authentication** — register/login with server-issued session cookies (`/api/auth/*`); `POST /api/meetings` is owner-authorized
- **Attendance** — per-participant join/leave log, downloadable as CSV or PDF (host only)
- **Local-disk recording** — the host picks a folder; the browser captures video + mixed audio and uploads the file to the server, which writes it to that folder on local disk
- **Responsive design** — works on desktop, tablet, and mobile

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand, simple-peer |
| Backend | Node.js, Express, Socket.io |
| Media | WebRTC P2P mesh (simple-peer, browser-to-browser) |
| Real-time state | WebSocket (Socket.io: signaling, presence, host controls, waiting room, attendance, breakout, recording) |
| Collab channels | Socket.io relay (`collab-relay` / `collab-message`: chat, reactions, poll, qa, whiteboard) |
| Persistence | Turso libSQL (SQLite-compatible; embedded replica syncs from cloud; local SQLite fallback) |

## Architecture

```
┌─────────────┐   Socket.io (signaling + state)   ┌──────────────────┐
│  React App  │ ◄───────────────────────────────► │  Node.js Server   │
│  (Client A) │   offer/answer/ICE candidates /    │  (Express + io)   │
└──────┬──────┘   presence / host controls /        └──────────────────┘
       │           collab relay (chat/poll/...)              ▲
       │  WebRTC (SRTP) direct P2P                          │ REST
       │  audio/video/screen mesh                           │ (recording upload,
       │                                                    │  attendance, breakouts)
┌──────▼──────┐                                             │
│  React App  │ ◄───────────────────────────────────────────┘
│  (Client B) │   (same socket contract as Client A)
└─────────────┘
```

How it works:
1. Users register/login; the server issues a session cookie (real auth).
2. Joining a room: socket.io joins the room; the server relays `collab` events.
3. The joining client initiates WebRTC peer connections (`OFFER`/`ANSWER`/`ICE_CANDIDATE`
   relayed over socket.io) to every existing participant, and existing peers connect back —
   a full P2P mesh. Media never touches the server.
4. Chat, reactions, polls, Q&A, and whiteboard ride the `collab-relay` socket channel, so
   the backend is a thin forwarder and everyone stays in sync.
5. Recording: the host enters a folder on local disk, the browser records (MediaRecorder +
   WebAudio mix of remote participants), and the server stores the uploaded file there.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (comes with npm)
- Webcam & microphone (for video/audio calls)
- Modern browser (Chrome, Firefox, Edge recommended)
- No third-party media services required

### Installation

```bash
# Install all dependencies (root + client + server)
npm run install:all

# OR install manually:
npm install                           # root (dev tools)
cd server && npm install              # backend
cd ../client && npm install           # frontend
```

### Configuration (server/.env)

```env
PORT=3001
CLIENT_URL=http://localhost:5173

# Secret used to sign auth session cookies
JWT_SECRET=change-me

# Optional WebRTC TURN relay (Cloudflare Realtime) - required only when
# neither peer can reach the other directly (symmetric NAT / CGNAT). Get a
# TURN key at dash.cloudflare.com (Realtime -> TURN), then set its uid and
# secret. The backend fetches short-lived credentials per hour and serves them
# to clients at GET /api/turn-credentials. Billed $0.05/real-time GB outbound,
# only when a call actually needs the relay.
# CLOUDFLARE_TURN_KEY_ID=
# CLOUDFLARE_TURN_KEY_API_TOKEN=

# Turso (libSQL) remote database - REQUIRED for persistence on Render (its
# free tier has no persistent disk, so a local SQLite file is wiped on every
# redeploy/restart). When both are set, the server runs an embedded replica
# that syncs to Turso every 60 seconds. Without them it falls back to a plain
# local SQLite file (fine for local dev).
#
# Create a free database:  https://turso.tech  ->  turso db create webinar
#   URL:   turso db show webinar --url           (libsql://webinar-<org>.turso.io)
#   Token: turso db tokens create webinar
TURSO_DATABASE_URL=libsql://webinar-<org>.turso.io
TURSO_AUTH_TOKEN=
```

### Running the App

```bash
# From the root directory - starts both server & client
npm run dev

# The app will be available at:
#   Frontend: http://localhost:5173
#   Backend:  http://localhost:3001
```

### Testing Locally

To test video calls, open the app in **two different browser windows** (incognito works):

1. **Window 1**: Register an account → start a meeting (or schedule one and click Start) → copy the invite link
2. **Window 2**: Open the invite link → join with a second account
3. Both clients should connect peer-to-peer (signaling relayed by the server) and see each other's video/audio

## Project Structure

```
webinar/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components (Meeting, Chat, Lobby, Participants, Polls, ...)
│   │   ├── hooks/          # Custom React hooks (useWebRTC, useMedia, useCollabChannel, useSocket)
│   │   ├── store/          # Zustand state management
│   │   ├── utils/          # Constants, codecs (chat/reactions/poll/qa/whiteboard), exports
│   │   ├── test/           # Unit tests (node:test)
│   │   ├── App.jsx         # Router setup
│   │   └── main.jsx        # Entry point
│   ├── index.html
│   ├── vite.config.js      # Proxies /api + /socket.io to the backend
│   └── tailwind.config.js
│
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.js        # Main server (Express + Socket.io + REST APIs)
│   │   ├── auth.js         # Register/login + session cookies
│   │   ├── rooms.js        # Room management (incl. scheduled-meeting materialization)
│   │   ├── meetings.js     # Meeting scheduling + start/end state
│   │   ├── invite.js       # ICS + Google Calendar links + join URLs
│   │   ├── signaling.js    # WebRTC signaling relay (offer/answer/candidate + collab relay)
│   │   ├── chat.js         # Chat + typing relay
│   │   ├── recording.js    # Local-disk recording storage (host-chosen folder)
│   │   ├── breakout.js     # Breakout room provisioning (labeled groups)
│   │   ├── db.js           # Turso/libSQL persistence (async get/all/run/exec wrapper)
│   │   └── utils.js        # Helpers
│   ├── test/               # Server unit + integration tests
│   └── .env                # Environment config
│
└── package.json            # Root scripts
```

## Key Events (Socket.io)

### Client → Server
| Event | Description |
|-------|-------------|
| `join-room` / `leave-room` | Join / leave a meeting room |
| `offer` / `answer` / `ice-candidate` | WebRTC signaling relay (P2P) |
| `collab-relay` | Relay one payload on a collab channel (`chat`, `reactions`, `poll`, `qa`, `whiteboard`) |
| `typing-indicator` | Broadcast typing status |
| `mute-participant` / `kick-participant` | Host moderation |
| `lock-room` / `toggle-waiting-room` | Host room state |
| `admit-waiting` / `deny-waiting` | Waiting-room admission (host) |
| `start-recording` / `stop-recording` | Recording state broadcast (host-gated) |
| `get-attendance` | Attendance log request |

### Server → Client
| Event | Description |
|-------|-------------|
| `room-joined` | Successfully joined a room (with settings + participants) |
| `participant-joined` / `participant-left` | Presence changes (+ host transfer) |
| `collab-message` | Relay of a collab-channel payload (chat/poll/qa/whiteboard/reactions) |
| `user-typing` | Remote typing indicator |
| `kicked` / `force-mute` / `room-locked` | Host actions |
| `recording-started` / `recording-stopped` | Recording state |
| `attendance-updated` / `waiting-list-updated` | Live lists |
| `breakout-updated` | Breakout room layout changes |

### Collab relay channels
| Channel | Payload | Use |
|---------|---------|-----|
| `chat` | `{id, sender, body, ts}` codec | Chat messages |
| `reactions` | `{type, emoji, sender, ts}` | Reaction bursts |
| `poll` | `{action, pollId, question, options, vote...}` | Live polls |
| `qa` | `{action, questionId, body, upvote, answered...}` | Q&A |
| `whiteboard` | serialized Excalidraw deltas | Shared whiteboard |

All collab channels ride the `collab-relay` / `collab-message` socket pair instead
of proprietary data channels — one shared transport, no per-channel sessions.

## Recording To Local Disk

- **Who**: only the meeting host (server re-validates `x-host-id`; `hostId` must match the room host's socket id).
- **How**: the host types a folder path (e.g. `E:\WebinarRecordings` or `~/Screencasts`).
  The browser records the screen/camera plus a WebAudio mix of remote participants,
  then uploads the file as base64 JSON.
- **Where**: the server writes the file to exactly that folder (creating it if missing)
  and records a row in SQLite (`recordings` table). The saved path is returned to the host.
- **Format**: `.webm` (browser-native MediaRecorder).

## FAQ

### How many participants can join?

Media flows peer-to-peer (a full mesh), so every client uploads once per peer —
bandwidth cost is O(n²). This is ideal for small-to-medium meetings (roughly 2–15
participants depending on upload speed). There is no SFU and no server-side
relay, so there is also no per-minutes media cost.

### Does the server handle video?

No. It relays WebRTC signaling (offers/answers/ICE candidates) and all non-media
state over socket.io. Audio/video/screen data goes browser-to-browser directly.

### Why does recording go to local disk?

There is no cloud media server to transcode on. Recording is intentionally
host-side: the browser captures what the host sees/hears and the server persists
the file to the folder the host chose. This keeps media traffic zero-cost and
the files entirely under the host's control.

## Roadmap

- [x] P2P video/audio calls (simple-peer mesh)
- [x] Screen sharing
- [x] Real-time chat (collab relay) + typing indicators
- [x] Participant management (host mute/kick, host transfer)
- [x] Host controls (mute/kick/lock/waiting room)
- [x] Pre-join lobby with camera preview & device picker
- [x] Responsive UI (desktop/tablet/mobile)
- [x] **Reverted from LiveKit SFU back to pure P2P WebRTC** (no media server)
- [x] Local-disk recording (host-chosen folder)
- [x] Breakout rooms (labeled groups over the collab relay)
- [x] **Authentication & real user accounts** (register/login, session cookies)
- [x] **Meeting scheduling & calendar integration** (ICS + Google Calendar links)
- [x] Waiting room (host admit/deny)
- [x] Reactions & emoji (relay bursts)
- [x] Polls & Q&A (relay + SQLite persistence)
- [x] Whiteboard (Excalidraw, delta sync + persistence)
- [x] Attendance export (CSV/PDF)

## License

MIT