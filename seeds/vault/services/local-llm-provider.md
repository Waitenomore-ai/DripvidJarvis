---
title: Local LLM provider (LM Studio)
tags: [llm, provider, dev]
---

# Local LLM provider (development)

The local dev box runs LM Studio at `http://127.0.0.1:1234/v1`
(OpenAI-compatible) and JARVIS is configured via `.env`:

- `JARVIS_OPENAI_BASE_URL=http://127.0.0.1:1234/v1`
- `JARVIS_OPENAI_API_KEY=lm-studio`
- `JARVIS_OPENAI_MODEL=qwen2.5-coder-7b-instruct`

Model notes:

- `qwen2.5-coder-7b-instruct` is fast and workable but never emits real
  structured `tool_calls`; it fakes JSON tool invocations inside its answer,
  so diagnostic answers carry the "no live checks verified" note when in
  diagnostic mode.
- `qwen/qwen3.8-27b` times out (>150s) on this machine — unusable.
- `deepseek/deepseek-r1-0528-qwen3-8b` is slow (~47s) and emits no
  `tool_calls` either.
- Embeddings: `text-embedding-nomic-embed-text-v1.5`.

Production replaces this with a cloud OpenAI-compatible endpoint
(`deploy/dripvid-jarvis.env.example`).