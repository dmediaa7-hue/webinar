# Webinar - Video Conferencing Platform

A web-based video conferencing application inspired by Zoom, built with React + LiveKit
(SFU) on the frontend and Node.js + Express + Socket.io on the backend.

## Features

**Media (LiveKit SFU)**
- **HD video & audio calls** — media flows through a LiveKit Selective Forwarding Unit (SFU)
- **Screen sharing** — share your entire screen or a specific window
- **Virtual backgrounds** — blur, replace with an image, or none (`@livekit/track-processors`)
- **Pre-join lobby** — camera preview + device picker before publishing

**Collaboration**
- **Real-time chat** — messages over the LiveKit data channel with typing indicators
- **Reactions & emoji** — transient overlay bursts on participant tiles
- **Polls & Q&A** — host-created polls with live results; Q&A with upvotes and host-mark-answered (persisted to SQLite)
- **Whiteboard** — shared Excalidraw canvas, delta-synced over the data channel (persisted to SQLite)
- **Closed captions / live transcription** — renders transcription data-channel segments (graceful empty state without an agent)

**Meetings & scheduling**
- **Meeting scheduling** — create future meetings (title, start time, duration, passcode, waiting room); ICS download + Google Calendar "Add to Calendar" link
- **Start/Join** — Start materializes the live room; guests join via invite link; expired meetings show "meeting has ended"

**Moderation & safety**
- **Participant management** — live participant list, host mute/kick, host transfer
- **Host controls** — room locking, waiting room with admit/deny, force-mute
- **Waiting room** — joiners are held until the host admits them
- **Breakout rooms** — host provisions separate LiveKit rooms and moves participants via `RoomServiceClient.moveParticipant`

**Accounts & recording**
- **Real authentication** — register/login with server-issued session cookies (`/api/auth/*`); `POST /api/meetings` is owner-authorized
- **Attendance** — per-participant join/leave log, downloadable as CSV or PDF (host only)
- **Cloud recording** — LiveKit Egress room-composite recording (gracefully disabled when keys are absent)
- **Responsive design** — works on desktop, tablet, and mobile

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand, LiveKit (`livekit-client`, `@livekit/components-react`) |
| Backend | Node.js, Express, Socket.io |
| Media | LiveKit SFU (WebRTC, server-relayed) |
| Real-time state | WebSocket (Socket.io for non-media signaling: presence, host controls, waiting room, attendance, breakout, recording) |
| Collab channels | LiveKit data channels (`chat`, `reactions`, `poll`, `qa`, `whiteboard`) |
| Persistence | SQLite (rooms, auth sessions, scheduled meetings, polls, Q&A, whiteboards) |

## Architecture

```
┌─────────────┐   Socket.io (REST-ish state)   ┌──────────────────┐
│  React App  │ ◄────────────────────────────► │  Node.js Server  │
│  (Client)   │   presence / host controls /    │  (Express + io)  │
└──────┬──────┘   waiting room / attendance     └────────┬─────────┘
       │                                                │
       │  HTTPS/WSS                                    │  REST + SDK
       │  media + data channels                        │  (token, egress,
       ▼                                                ▼  moveParticipant)
┌──────────────────────────────┐            ┌──────────────────────┐
│        LiveKit SFU           │            │      LiveKit Cloud    │
│  (audio/video/screen relay)  │ ◄────────► │  (SFU + agents)       │
└──────────────────────────────┘            └──────────────────────┘
```

How it works:
1. Users register/login; the server issues a session cookie (real auth, no fake credentials).
2. Joining a room: the client requests a LiveKit token from the backend REST endpoint, then
   connects to the LiveKit SFU — all audio/video/screen-share traffic flows through the SFU.
3. The chat, reactions, polls, Q&A, and whiteboard channels ride LiveKit **data channels**,
   so latency is low and the backend stays out of the media path.
4. Socket.io handles non-media state that LiveKit does not: participant presence/attendance,
   host mute/kick/lock, waiting-room admission, breakout coordination, and recording start/stop.
5. If LiveKit keys are absent, key-gated features (media, recording, captions, virtual
   backgrounds) show a clear "not configured" disabled state — the rest of the app still works.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (comes with npm)
- Webcam & microphone (for video/audio calls)
- Modern browser (Chrome, Firefox, Edge recommended)
- Optional: a [LiveKit Cloud](https://cloud.livekit.io) project for media features

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

# LiveKit Cloud credentials — optional. Without these, LiveKit features show
# a "not configured" state; the rest of the app still works.
# Get them from https://cloud.livekit.io -> Project -> Settings -> Keys
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Secret used to sign auth session cookies
JWT_SECRET=change-me
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
3. Both clients should connect through LiveKit and see each other's video/audio

## Project Structure

```
webinar/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components (Meeting, Chat, Lobby, Participants, Polls, ...)
│   │   ├── hooks/          # Custom React hooks (useLiveKitRoom, useLiveKitSync, useSocket)
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
│   │   ├── signaling.js    # WebRTC signaling relay (offer/answer/candidate)
│   │   ├── chat.js         # Chat + typing relay
│   │   ├── recording.js    # LiveKit Egress cloud recording
│   │   ├── livekit.js      # LiveKit token/URL helpers
│   │   ├── db.js           # SQLite persistence
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
| `typing-indicator` | Broadcast typing status (chat itself is on a data channel) |
| `mute-participant` / `kick-participant` | Host moderation |
| `lock-room` / `toggle-waiting-room` | Host room state |
| `admit-waiting` / `deny-waiting` | Waiting-room admission (host) |
| `start-recording` / `stop-recording` | LiveKit Egress recording |
| `get-attendance` | Attendance log request |

### Server → Client
| Event | Description |
|-------|-------------|
| `room-joined` | Successfully joined a room (with settings + participants) |
| `participant-joined` / `participant-left` | Presence changes (+ host transfer) |
| `user-typing` | Remote typing indicator |
| `kicked` / `force-mute` / `room-locked` | Host actions |
| `recording-started` / `recording-stopped` | Recording state |
| `attendance-updated` / `waiting-list-updated` | Live lists |
| `breakout-updated` | Breakout room layout changes |

### Data channels (LiveKit)
| Channel | Payload | Use |
|---------|---------|-----|
| `chat` | `{id, sender, body, ts}` codec | Chat messages |
| `reactions` | `{type, emoji, sender, ts}` | Reaction bursts |
| `poll` | `{action, pollId, question, options, vote...}` | Live polls |
| `qa` | `{action, questionId, body, upvote, answered...}` | Q&A |
| `whiteboard` | serialized Excalidraw deltas | Shared whiteboard |
| `lk.transcription` | segments | Closed captions |

## FAQ

### How many participants can join?

Media flows through a LiveKit SFU, so a single server can relay hundreds of
participants (the SFU forwards, never re-encodes). For truly large webinars you
scale LiveKit horizontally (Redis multi-node) rather than the browser doing all
the work.

### Does the server handle video?

It relays signaling and issues tokens, but LiveKit's SFU forwards the actual
media. This keeps per-client bandwidth fixed (each client uploads once) instead
of the O(n²) cost of pure P2P mesh.

### Why does recording require LiveKit keys?

Recording uses LiveKit Egress — the SFU transcodes the room to a file on the
server side. Without `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` in
`server/.env` the recording button is disabled with a clear message, and the
media features show a "LiveKit is not configured" notice.

## Roadmap

- [x] P2P video/audio calls
- [x] Screen sharing
- [x] Real-time chat (data channel) + typing indicators
- [x] Participant management (host mute/kick, host transfer)
- [x] Host controls (mute/kick/lock/waiting room)
- [x] Pre-join lobby with camera preview & device picker
- [x] Responsive UI (desktop/tablet/mobile)
- [x] **SFU architecture via LiveKit** (replaces P2P/simple-peer)
- [x] Cloud recording (LiveKit Egress)
- [x] Virtual backgrounds (blur / image / none)
- [x] Breakout rooms (multi-room + `moveParticipant`)
- [x] **Authentication & real user accounts** (register/login, session cookies)
- [x] **Meeting scheduling & calendar integration** (ICS + Google Calendar links)
- [x] Waiting room (host admit/deny)
- [x] Closed captions / live transcription (data channel, graceful empty state)
- [x] Reactions & emoji (data-channel bursts)
- [x] Polls & Q&A (data channel + SQLite persistence)
- [x] Whiteboard (Excalidraw, delta sync + persistence)
- [x] Attendance export (CSV/PDF)

## License

MIT