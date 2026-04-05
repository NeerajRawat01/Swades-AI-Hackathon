# Swades AI: Voice Recorder + Live Transcription

A working full-stack app for:
- recording microphone audio in the browser (chunked WAV),
- uploading chunks to FastAPI,
- getting live transcription from AssemblyAI,
- showing transcript in the Next.js UI.

## Stack

- Frontend: Next.js 16 + React 19 + Tailwind
- Backend: FastAPI + SQLAlchemy
- Transcription: AssemblyAI API
- DB: PostgreSQL (Docker, optional for chunk ack records)
- Monorepo: Turborepo + npm workspaces

## Repository Layout

```text
.
├── apps/
│   └── web/                 # Next.js frontend
├── fastapi-server/          # FastAPI backend
│   ├── main.py
│   ├── db.py
│   ├── docker-compose.yml
│   ├── .env.example
│   └── requirements.txt
└── packages/                # shared packages (ui/env/etc.)
```

## 1) Local Setup (Fastest)

### Prerequisites

- Node.js 20+
- npm 10+
- Python 3.9+
- Docker Desktop (for Postgres)
- AssemblyAI API key

### Install frontend deps

From repo root:

```bash
npm install
```

### Setup backend env

```bash
cp fastapi-server/.env.example fastapi-server/.env.local
```

Edit `fastapi-server/.env.local` and set:

```env
ASSEMBLYAI_API_KEY=your_real_key
FRONTEND_ORIGIN=http://localhost:3001
TRANSCRIPTION_PROVIDER=assemblyai
ASSEMBLYAI_SPEECH_MODELS=universal-3-pro,universal-2
# Optional:
# ASSEMBLYAI_LANGUAGE_CODE=en
```

### Setup frontend env

```bash
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local`:

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:8000
```

### Install backend Python deps

```bash
cd fastapi-server
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 2) Run Locally

### Terminal A: Backend

```bash
cd fastapi-server
source .venv/bin/activate
docker compose up -d
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### Terminal B: Frontend

From repo root:

```bash
npm run dev:web
```

Open:

- `http://localhost:3001`

Important: use `localhost` (not LAN IP) for reliable microphone permissions.

## 3) How It Works

1. Browser records audio and creates WAV chunks (~5s each).
2. Frontend sends chunk to `POST /api/chunks/upload`.
3. Backend uploads/transcribes with AssemblyAI.
4. UI appends transcript text as results return.
5. Silence-only chunks are ignored (no noisy error in UI).

## 4) API Endpoints

- `GET /health`
  - backend status + transcription provider info
- `POST /api/chunks/upload`
  - body:
    - `chunkId: string`
    - `dataBase64: string` (audio payload)
    - `mimeType: "audio/wav"`
  - response:
    - `status`
    - `chunkId`
    - `transcription`
    - `transcription_error`
- `GET /api/chunks/reconcile`
  - checks missing chunk files against DB ack list

## 5) Quick Deployment (30-Minute Path)

### Frontend (Vercel)

1. Import this repo in Vercel.
2. Set project root to `apps/web`.
3. Add env:
   - `NEXT_PUBLIC_SERVER_URL=https://<your-backend-domain>`
4. Deploy.

### Backend (Render / Railway / Fly.io)

1. Deploy `fastapi-server` as Python service.
2. Build/install command:
   - `pip install -r requirements.txt`
3. Start command:
   - `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env vars from `fastapi-server/.env.example`.
5. Set `FRONTEND_ORIGIN` to your deployed frontend URL.

### Database

- For local/demo: use current Docker Postgres.
- For cloud deploy: point `DATABASE_URL` in `fastapi-server/db.py` to managed Postgres (recommended next step).

## 6) Useful Commands

From repo root:

- `npm run dev:web` -> run web app
- `npm run check-types` -> TypeScript checks
- `npm run build` -> monorepo build

## 7) Troubleshooting

- `ASSEMBLYAI_API_KEY is not set on backend`
  - ensure key is in `fastapi-server/.env.local`
  - restart backend

- AssemblyAI 400 with `speech_models` required
  - ensure `ASSEMBLYAI_SPEECH_MODELS=universal-3-pro,universal-2`

- Mic/Record button appears not working
  - open app on `http://localhost:3001`
  - allow microphone permission in browser

- Slow transcription
  - network/API latency + chunk-by-chunk processing is expected

## Security Notes

- Never commit real API keys.
- If a key is exposed, rotate it immediately in provider dashboard.

