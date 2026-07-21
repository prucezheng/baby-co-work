from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


DEFAULT_MODEL = "doubao-seed-2-0-lite-260428"
DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
SUPPORTED_AUDIO_FORMATS = {"mp3", "wav"}
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MIME_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
}
PROCESSING_STATUSES = {"processing", "uploaded", "pending", "queued"}
READY_STATUSES = {"processed", "completed", "succeeded", "success", "available", "ready"}
FAILED_STATUSES = {"failed", "error", "cancelled", "expired"}


class TranscriptionError(RuntimeError):
    pass


def transcribe_media_file(file_path: str | Path, *, keep_files: bool = False) -> str:
    source_path = Path(file_path).expanduser()
    if not source_path.exists():
        raise TranscriptionError(f"file does not exist: {source_path}")
    if not source_path.is_file():
        raise TranscriptionError(f"path is not a file: {source_path}")

    api_key = os.getenv("ARK_API_KEY")
    if not api_key:
        raise TranscriptionError("ARK_API_KEY is not set")

    model = os.getenv("ARK_MODEL", DEFAULT_MODEL)
    base_url = os.getenv("ARK_BASE_URL", DEFAULT_BASE_URL).rstrip("/")

    temp_dir = Path(tempfile.mkdtemp(prefix="ark-audio-"))
    try:
        audio_path = ensure_audio_input(source_path, temp_dir)
        file_id = upload_ark_file(
            file_path=audio_path,
            api_key=api_key,
            base_url=base_url,
        )
        wait_for_ark_file(
            file_id=file_id,
            api_key=api_key,
            base_url=base_url,
        )
        transcript = call_ark_transcription(
            file_id=file_id,
            api_key=api_key,
            model=model,
            base_url=base_url,
        )
        return transcript.strip()
    finally:
        if not keep_files:
            shutil.rmtree(temp_dir, ignore_errors=True)


def ensure_audio_input(media_path: Path, output_dir: Path) -> Path:
    suffix = media_path.suffix.lower().lstrip(".")
    if suffix in SUPPORTED_AUDIO_FORMATS and media_path.stat().st_size <= MAX_AUDIO_BYTES:
        return media_path

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise TranscriptionError("ffmpeg is required to extract audio from the local media file")

    audio_path = output_dir / "audio.mp3"
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(media_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        str(audio_path),
    ]
    run_command(command, timeout=180, label="ffmpeg")
    if not audio_path.exists() or audio_path.stat().st_size == 0:
        raise TranscriptionError("ffmpeg did not produce an audio file")
    if audio_path.stat().st_size > MAX_AUDIO_BYTES:
        raise TranscriptionError("audio file is too large after compression")
    return audio_path


def upload_ark_file(*, file_path: Path, api_key: str, base_url: str) -> str:
    fields = {"purpose": "user_data"}
    files = {
        "file": (
            file_path.name,
            file_path.read_bytes(),
            MIME_TYPES.get(file_path.suffix.lower().lstrip("."), "application/octet-stream"),
        )
    }
    body, content_type = encode_multipart_form(fields, files)

    request = urllib.request.Request(
        f"{base_url}/files",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": content_type,
        },
        method="POST",
    )
    data = send_json_request(request, timeout=240, label="Ark file upload")
    file_id = data.get("id")
    if not file_id:
        raise TranscriptionError(f"Ark file upload response did not contain id: {data}")
    return file_id


def wait_for_ark_file(*, file_id: str, api_key: str, base_url: str) -> None:
    deadline = time.monotonic() + 180
    last_status = None
    while time.monotonic() < deadline:
        request = urllib.request.Request(
            f"{base_url}/files/{file_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            method="GET",
        )
        data = send_json_request(request, timeout=60, label="Ark file status")
        status = str(data.get("status", "")).lower()
        last_status = status or last_status
        if not status or status in READY_STATUSES:
            return
        if status in FAILED_STATUSES:
            raise TranscriptionError(f"Ark file processing failed: {data}")
        if status not in PROCESSING_STATUSES:
            return
        time.sleep(2)

    raise TranscriptionError(f"Ark file processing timed out; last status: {last_status}")


def call_ark_transcription(*, file_id: str, api_key: str, model: str, base_url: str) -> str:
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "file_id": file_id,
                    },
                    {
                        "type": "input_text",
                        "text": (
                            "请完整转写这段音频中的所有可听人声内容。"
                            "只输出转写全文，不要总结、不要解释、不要添加标题。"
                            "听不清处标记为[听不清]。"
                        ),
                    },
                ],
            }
        ],
    }

    request = urllib.request.Request(
        f"{base_url}/responses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    data = send_json_request(request, timeout=240, label="Ark transcription")

    if data.get("status") not in (None, "completed"):
        raise TranscriptionError(f"Ark API response status is {data.get('status')}")
    if "error" in data:
        raise TranscriptionError(f"Ark API error: {data['error']}")

    text = extract_output_text(data)
    if not text:
        raise TranscriptionError("Ark API response did not contain output text")
    return text


def encode_multipart_form(
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = f"----ark-audio-{uuid.uuid4().hex}"
    lines: list[bytes] = []

    for name, value in fields.items():
        lines.extend(
            [
                f"--{boundary}".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"'.encode("utf-8"),
                b"",
                value.encode("utf-8"),
            ]
        )

    for name, (filename, content, content_type) in files.items():
        safe_filename = filename.replace('"', "")
        lines.extend(
            [
                f"--{boundary}".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{safe_filename}"'
                ).encode("utf-8"),
                f"Content-Type: {content_type}".encode("utf-8"),
                b"",
                content,
            ]
        )

    lines.append(f"--{boundary}--".encode("utf-8"))
    lines.append(b"")
    return b"\r\n".join(lines), f"multipart/form-data; boundary={boundary}"


def send_json_request(
    request: urllib.request.Request,
    *,
    timeout: int,
    label: str,
) -> dict:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_data = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise TranscriptionError(f"{label} returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise TranscriptionError(f"{label} request failed: {exc.reason}") from exc

    try:
        return json.loads(response_data)
    except json.JSONDecodeError as exc:
        raise TranscriptionError(f"{label} returned invalid JSON") from exc


def extract_output_text(data: dict) -> str:
    chunks: list[str] = []
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks)


def run_command(command: list[str], *, timeout: int, label: str) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TranscriptionError(f"{label} timed out") from exc

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip()
        raise TranscriptionError(f"{label} failed: {message}")
    return completed
