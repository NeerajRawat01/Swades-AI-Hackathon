import base64
import json
import os
import time
from pathlib import Path
from typing import Optional, Tuple
from urllib import error, request

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from db import engine

app = FastAPI()

def load_env_file(file_name: str) -> None:
    env_path = Path(__file__).resolve().parent / file_name
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (key not in os.environ or not os.environ.get(key, "").strip()):
            os.environ[key] = value


load_env_file(".env.local")
load_env_file(".env")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3001")
transcription_provider = os.getenv("TRANSCRIPTION_PROVIDER", "assemblyai")
assembly_api_key = os.getenv("ASSEMBLYAI_API_KEY")
assembly_language_code = os.getenv("ASSEMBLYAI_LANGUAGE_CODE")
assembly_speech_models_raw = os.getenv(
    "ASSEMBLYAI_SPEECH_MODELS", "universal-3-pro,universal-2"
)
assembly_speech_models = [
    model.strip() for model in assembly_speech_models_raw.split(",") if model.strip()
]
assembly_poll_interval_sec = float(os.getenv("ASSEMBLYAI_POLL_INTERVAL_SEC", "1.2"))
assembly_timeout_sec = int(os.getenv("ASSEMBLYAI_TIMEOUT_SEC", "180"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "chunks"
os.makedirs(UPLOAD_DIR, exist_ok=True)

class Chunk(BaseModel):
    chunkId: str
    data: Optional[str] = None
    dataBase64: Optional[str] = None
    mimeType: Optional[str] = None


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "transcription_enabled": bool(assembly_api_key),
        "transcription_backend": transcription_provider,
    }


def transcribe_with_assemblyai(file_path: str) -> Tuple[Optional[str], Optional[str]]:
    if not assembly_api_key:
        return None, "ASSEMBLYAI_API_KEY is not set on backend."

    try:
        with open(file_path, "rb") as audio_file:
            audio_bytes = audio_file.read()

        upload_request = request.Request(
            "https://api.assemblyai.com/v2/upload",
            method="POST",
            data=audio_bytes,
            headers={"authorization": assembly_api_key, "content-type": "application/octet-stream"},
        )
        with request.urlopen(upload_request, timeout=assembly_timeout_sec) as upload_response:
            upload_payload = json.loads(upload_response.read().decode("utf-8"))
        upload_url = upload_payload.get("upload_url")
        if not upload_url:
            return None, "AssemblyAI upload failed: missing upload_url."

        transcript_body = {"audio_url": upload_url}
        transcript_body["speech_models"] = assembly_speech_models or ["universal-2"]
        if assembly_language_code:
            transcript_body["language_code"] = assembly_language_code
        else:
            transcript_body["language_detection"] = True

        start_request = request.Request(
            "https://api.assemblyai.com/v2/transcript",
            method="POST",
            data=json.dumps(transcript_body).encode("utf-8"),
            headers={
                "authorization": assembly_api_key,
                "content-type": "application/json",
            },
        )
        with request.urlopen(start_request, timeout=assembly_timeout_sec) as start_response:
            start_payload = json.loads(start_response.read().decode("utf-8"))

        transcript_id = start_payload.get("id")
        if not transcript_id:
            return None, "AssemblyAI transcript start failed: missing transcript id."

        deadline = time.time() + assembly_timeout_sec
        while time.time() < deadline:
            poll_request = request.Request(
                f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                method="GET",
                headers={"authorization": assembly_api_key},
            )
            with request.urlopen(poll_request, timeout=assembly_timeout_sec) as poll_response:
                poll_payload = json.loads(poll_response.read().decode("utf-8"))

            status = poll_payload.get("status")
            if status == "completed":
                text_value = (poll_payload.get("text") or "").strip()
                if text_value:
                    return text_value, None
                return None, "Transcription completed but returned empty text."
            if status == "error":
                error_message = str(poll_payload.get("error") or "")
                error_lower = error_message.lower()
                if "no spoken audio" in error_lower or (
                    "language_detection" in error_lower and "cannot be performed" in error_lower
                ):
                    return None, None
                return None, f"AssemblyAI transcription error: {error_message}"

            time.sleep(assembly_poll_interval_sec)

        return None, "AssemblyAI transcription timed out."
    except error.HTTPError as http_error:
        details = http_error.read().decode("utf-8", errors="ignore")
        details_lower = details.lower()
        if "no spoken audio" in details_lower or (
            "language_detection" in details_lower and "cannot be performed" in details_lower
        ):
            return None, None
        return None, f"AssemblyAI request failed ({http_error.code}): {details}"
    except Exception as exc:
        return None, f"AssemblyAI request failed: {exc}"

@app.post("/api/chunks/upload")
async def upload_chunk(chunk: Chunk):
    transcription = None
    transcription_error = None

    if chunk.dataBase64:
        try:
            audio_bytes = base64.b64decode(chunk.dataBase64)
        except Exception:
            return {
                "status": "error",
                "chunkId": chunk.chunkId,
                "transcription": None,
                "transcription_error": "Invalid base64 audio payload.",
            }

        file_path = f"{UPLOAD_DIR}/{chunk.chunkId}.wav"
        with open(file_path, "wb") as f:
            f.write(audio_bytes)
        transcription, transcription_error = transcribe_with_assemblyai(file_path)
    else:
        file_path = f"{UPLOAD_DIR}/{chunk.chunkId}.txt"
        payload_text = chunk.data or ""
        with open(file_path, "w") as f:
            f.write(payload_text)

    # Insert into DB (ack)
    with engine.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS chunks ("
                "chunk_id TEXT PRIMARY KEY, "
                "created_at TIMESTAMP DEFAULT NOW()"
                ")"
            )
        )
        conn.execute(
            text("INSERT INTO chunks (chunk_id) VALUES (:cid) ON CONFLICT DO NOTHING"),
            {"cid": chunk.chunkId}
        )
        conn.commit()

    return {
        "status": "uploaded",
        "chunkId": chunk.chunkId,
        "transcription": transcription,
        "transcription_error": transcription_error,
    }


@app.get("/api/chunks/reconcile")
async def reconcile():
    missing = []

    with engine.connect() as conn:
        result = conn.execute(text("SELECT chunk_id FROM chunks"))
        chunk_ids = [row[0] for row in result]

    for cid in chunk_ids:
        file_path = f"{UPLOAD_DIR}/{cid}.txt"
        if not os.path.exists(file_path):
            missing.append(cid)

    return {"missing_chunks": missing}
