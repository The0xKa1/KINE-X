# KINE//X LLM Proxy Backend

A tiny FastAPI service that holds the LLM credentials so the browser never
sees them. The frontend used to read `baseUrl` / `apiKey` / `model` from a
Camera Settings panel and call `${baseUrl}/chat/completions` directly. Now
the frontend calls this service instead.

## Endpoints

| Method | Path               | Purpose                                            |
| ------ | ------------------ | -------------------------------------------------- |
| GET    | `/api/health`      | Liveness + config check                            |
| POST   | `/api/segment`     | Video data URL → MLLM `/chat/completions` (JSON)   |
| POST   | `/api/chat-stream` | Streaming SSE chat completion proxy                |

## Setup

```bash
# from repo root
npm run server:install               # one-time: creates server/.venv and pip installs
cp .env.example .env                 # then edit .env with your real key
npm run server                       # starts uvicorn on :8766
```

In another terminal:

```bash
npm run dev                          # frontend on :5173
```

## Env vars

| Var                       | Required | Notes                                     |
| ------------------------- | -------- | ----------------------------------------- |
| `LLM_BASE_URL`            | yes      | e.g. `https://api.openai-next.com`        |
| `LLM_API_KEY`             | yes      | bearer token                              |
| `LLM_MODEL`               | yes      | e.g. `gpt-5.5`                            |
| `KINEX_CORS_ORIGINS` | no       | comma list; defaults to localhost:5173    |

The `.env` file is sourced by the `npm run server` script (`set -a; source
.env; set +a`). No python-dotenv dependency.

## Manual smoke

```bash
# health
curl -s http://localhost:8766/api/health | jq

# streaming chat (small request, fast feedback)
curl -N -X POST http://localhost:8766/api/chat-stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"用一句话介绍 KINE//X"}],"max_tokens":80,"temperature":0.6}'
```

You should see `data: {...}` SSE lines ending with `data: [DONE]`.
