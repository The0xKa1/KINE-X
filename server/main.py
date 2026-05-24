"""HoloMotion LLM proxy backend.

Holds the LLM credentials (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL) so the
browser never sees them. Exposes two endpoints that mirror what the
frontend used to call directly:

    POST /api/segment      -> forwards a video data URL to /chat/completions
    POST /api/chat-stream  -> proxies a streaming SSE chat completion

Both endpoints adapt the OpenAI-compatible request/response shape that the
upstream provider expects.
"""

from __future__ import annotations

import json
import os
import traceback
from typing import Any, AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("HOLOMOTION_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

SEGMENT_SYSTEM_PROMPT = (
    "你是 HoloMotion 的运动视频分析引擎。只输出 JSON，不要输出 Markdown。"
    "用户会按时间顺序给你若干张关键帧，每张都标有时间戳（秒）。"
    "你需要根据动作变化把视频切分成若干段，每段对应一个完整动作单元，并给出元数据。"
)

SEGMENT_TIMEOUT_S = 300.0
CHAT_TIMEOUT_S = 60.0


app = FastAPI(title="HoloMotion LLM Proxy", version="0.1.0")
if ALLOWED_ORIGINS:
    # Explicit allow-list — useful in production / when you want to tighten things.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
else:
    # Dev default: any http(s) origin (regex matches the Origin header pattern).
    # No credentials are exchanged so this is safe enough for a single-developer
    # dev box. Set HOLOMOTION_CORS_ORIGINS in .env to lock it down.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://[^/]+$",
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["Content-Type"],
    )


class SampledFrame(BaseModel):
    dataUrl: str
    timestampSec: float


class SegmentRequest(BaseModel):
    fileName: str = ""
    durationSeconds: float
    frames: list[SampledFrame] = Field(default_factory=list)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    messages: list[ChatMessage]
    max_tokens: int = Field(default=320, ge=1, le=8192)
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)


def _require_config() -> None:
    if not LLM_BASE_URL or not LLM_API_KEY or not LLM_MODEL:
        raise HTTPException(
            status_code=500,
            detail=(
                "Backend LLM credentials are not configured. "
                "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in the environment."
            ),
        )


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json",
    }


def _segment_payload(req: SegmentRequest) -> dict[str, Any]:
    if not req.frames:
        raise HTTPException(status_code=400, detail="frames is empty — frontend must sample at least 1 frame")

    timestamps = [round(f.timestampSec, 2) for f in req.frames]
    user_intro = (
        "请按动作变化把视频切分成若干段，输出 JSON：\n"
        '{"summary":"...","globalTags":["..."],"segments":'
        '[{"id":"seg-1","name":"...","actionLabel":"...","startSec":0,"endSec":2.4,'
        '"confidence":0.82,"metadata":{"难度":"中等","核心受力部位":"核心/下肢",'
        '"节奏感":"强"},"notes":"..."}]}。\n'
        f"视频文件：{req.fileName or '(无名)'}，总时长：{req.durationSeconds:.2f} 秒。\n"
        f"以下是 {len(req.frames)} 张关键帧，按时间顺序排列；每张图后面我会标出它的时间戳（秒）。"
        " 切分时段时长应当贴合相邻关键帧之间的间隔，segments 必须按时间升序、"
        f" startSec/endSec 都在 [0, {req.durationSeconds:.2f}] 内、segments 不能为空。"
    )

    content: list[dict[str, Any]] = [{"type": "text", "text": user_intro}]
    for idx, frame in enumerate(req.frames):
        content.append({"type": "text", "text": f"第 {idx + 1} 张，时间 {timestamps[idx]}s："})
        content.append({"type": "image_url", "image_url": {"url": frame.dataUrl}})

    return {
        "model": LLM_MODEL,
        "stream": False,
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 1200,
        "messages": [
            {"role": "system", "content": SEGMENT_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
    }


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "baseUrl": LLM_BASE_URL or None,
        "model": LLM_MODEL or None,
        "configured": bool(LLM_BASE_URL and LLM_API_KEY and LLM_MODEL),
    }


@app.post("/api/segment")
async def segment(req: SegmentRequest) -> JSONResponse:
    _require_config()
    payload = _segment_payload(req)
    url = f"{LLM_BASE_URL}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=SEGMENT_TIMEOUT_S) as client:
            response = await client.post(url, headers=_auth_headers(), json=payload)
    except httpx.TimeoutException as exc:
        kind = type(exc).__name__
        raise HTTPException(status_code=504, detail=f"Upstream timeout ({kind}): {exc!r}") from exc
    except httpx.HTTPError as exc:
        kind = type(exc).__name__
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Upstream error ({kind}): {exc!r}") from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream HTTP {response.status_code}: {response.text[:400]}",
        )

    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Upstream response was not JSON") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream missing choices[0].message.content: {str(data)[:400]}",
        ) from exc

    if not isinstance(content, str) or not content:
        raise HTTPException(status_code=502, detail="Upstream returned empty content")

    return JSONResponse({"content": content})


async def _stream_upstream(request_body: dict[str, Any]) -> AsyncIterator[bytes]:
    url = f"{LLM_BASE_URL}/chat/completions"
    async with httpx.AsyncClient(timeout=CHAT_TIMEOUT_S) as client:
        async with client.stream(
            "POST", url, headers=_auth_headers(), json=request_body
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                err = json.dumps(
                    {"error": "upstream", "status": response.status_code, "detail": body.decode("utf-8", "replace")[:400]}
                )
                yield f"data: {err}\n\n".encode("utf-8")
                yield b"data: [DONE]\n\n"
                return
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk


@app.post("/api/chat-stream")
async def chat_stream(req: ChatStreamRequest) -> StreamingResponse:
    _require_config()
    upstream_payload: dict[str, Any] = {
        "model": LLM_MODEL,
        "messages": [m.model_dump() for m in req.messages],
        "stream": True,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
    }
    return StreamingResponse(
        _stream_upstream(upstream_payload),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
