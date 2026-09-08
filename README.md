# Webinar - Video Conferencing Platform

A web-based video conferencing application inspired by Zoom, built with modern web technologies.

## Features

- **Video & Audio Calls** - WebRTC peer-to-peer connections with unlimited participants
- **Screen Sharing** - Share your entire screen or a specific window
- **Real-time Chat** - Per-room messaging with typing indicators
- **Participant Management** - See who's in the room, mute/kick participants (host only)
- **Host Controls** - Room locking, waiting room, participant moderation
- **Meeting Controls** - Mute/unmute, camera on/off, record (simulated)
- **Pre-join Lobby** - Preview your camera/mic before joining
- **Responsive Design** - Works on desktop, tablet, and mobile

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand, Simple-Peer |
| Backend | Node.js, Express, Socket.io |
| Real-time | WebSocket (Socket.io for signaling) |
| Media | WebRTC (peer-to-peer) |

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  React App  │ ◄────────────────► │  Node.js Server  │
│  (Client)   │    signaling only  │  (Signaling)     │
└──────┬──────┘                    └──────────────────┘
       │
       │ WebRTC (P2P - direct media)
       ▼
┌─────────────┐
│  React App  │
│  (Client)   │
└─────────────┘
```

How it works:
1. Clients connect to the server via Socket.io
2. Server relays signaling data (offer/answer/ICE candidates)
3. Once peers discover each other, media flows **directly** between clients (P2P)
4. Server never handles actual audio/video streams - only room state, chat, and signaling

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (comes with npm)
- Webcam & microphone (for video/audio calls)
- Modern browser (Chrome, Firefox, Edge recommended)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd webinar-app

# Install all dependencies (root + client + server)
npm run install:all

# OR install manually:
npm install                           # root (dev tools)
cd server && npm install              # backend
cd ../client && npm install           # frontend
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

1. **Window 1**: Create a meeting → copy the meeting ID
2. **Window 2**: Join the meeting with the copied ID
3. Both clients should connect and see each other's video/audio

## Project Structure

```
webinar-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── store/          # Zustand state management
│   │   ├── utils/          # Utilities & constants
│   │   ├── App.jsx         # Router setup
│   │   └── main.jsx        # Entry point
│   ├── index.html
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.js        # Main server (Express + Socket.io)
│   │   ├── rooms.js        # Room management
│   │   ├── signaling.js    # WebRTC signaling
│   │   ├── chat.js         # Chat handling
│   │   ├── recording.js    # Recording simulation
│   │   └── utils.js        # Helpers
│   └── .env                # Environment config
│
└── package.json            # Root scripts
```

## Key Events (Socket.io)

### Client → Server
| Event | Description |
|-------|-------------|
| `join-room` | Join a meeting room |
| `leave-room` | Leave the current room |
| `offer` | Send SDP offer (WebRTC) |
| `answer` | Send SDP answer (WebRTC) |
| `ice-candidate` | Exchange ICE candidates |
| `chat-message` | Send a chat message |
| `screen-share-started` | Begin screen sharing |
| `screen-share-stopped` | Stop screen sharing |

### Server → Client
| Event | Description |
|-------|-------------|
| `room-joined` | Successfully joined a room |
| `participant-joined` | New participant in room |
| `participant-left` | Participant left the room |
| `offer` / `answer` | Relay WebRTC signals |
| `ice-candidate` | Relay ICE candidates |
| `chat-message` | Incoming chat message |
| `kicked` | Removed by host |

## FAQ

### Can this handle unlimited participants?

Client-side WebRTC (SPT - Selective Packet Transfer) does support up to ~15-20 participants before bandwidth becomes an issue. For truly unlimited participants (1000+), you'd need to scale to a **Selective Forwarding Unit (SFU)** architecture like **LiveKit**, **Janus**, or **mediasoup**. The current P2P architecture is perfect for small-to-medium meetings (5-20 people).

To scale further:
1. Replace P2P with SFU-based WebRTC (e.g., LiveKit)
2. Add horizontal scaling with Redis for Socket.io
3. Use cloud recording (not client-side)

### Why does the server not handle video?

Server relaying would require handling raw video streams (expensive). P2P means video flows directly between browsers without a middleman - much cheaper and lower latency for small groups. For large groups, an SFU becomes necessary.

## Development

### Useful Commands

```bash
npm run dev          # Start both client & server (hot reload)
cd server && npm run dev   # Backend only
cd client && npm run dev   # Frontend only
cd client && npm run build # Production build
```

### Environment Variables (server/.env)

```env
PORT=3001
CLIENT_URL=http://localhost:5173
# Add TURN server credentials here for production NAT traversal
# TURN_URL=turn:your-turn-server.com:3478
# TURN_USERNAME=username
# TURN_CREDENTIAL=password
```

## Roadmap

- [x] P2P video/audio calls
- [x] Screen sharing
- [x] Real-time chat
- [x] Participant management
- [x] Host controls (mute/kick/lock)
- [x] Pre-join lobby
- [x] Responsive UI
- [ ] SFU architecture for large meetings (LiveKit)
- [ ] Cloud recording
- [ ] Virtual backgrounds
- [ ] Breakout rooms
- [ ] Authentication & user accounts
- [ ] Meeting scheduling & calendar integration
- [ ] Waiting room
- [ ] Closed captions / transcription
- [ ] Reactions & emoji
- [ ] Polls & Q&A
- [ ] Whiteboard

## License

MIT
