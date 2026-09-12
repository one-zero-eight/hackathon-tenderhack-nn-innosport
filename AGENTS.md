Be concise. Avoid overly long explanations. Provide direct answers, or apply code solutions with minimal extra commentary. Only include clarifications if explicitly requested or really necessary, to reduce token usage and keep responses focused. Don't ask for unnecessary permission, just go.

### Code

DO NOT CREATE useless md files such as QUICKSTART, TASK and so on.
DO NOT MAKE ridiculous fallbacks.
DO NOT MAKE any backward compatibility shit unless requested.
DO NOT EVER WRITE "try: import ... except", as all libraries are expected to be installed.
DO NOT WRITE "from __future__ import annotations", as Python 3.14+ uses deferred annotations by default.
DO NOT USE `response_model=` in route decorator, use type hints instead:

    ```python
    # Good.
    @router.get("/scenes/")
    async def scenes() -> list[Scene]:
        return await repo.get_all_scenes()

    # Bad.
    @router.get("/scenes/", response_model=list[Scene])
    async def scenes():
        return await repo.get_all_scenes()
    ```

This repo is InnoSport: a React/Vite frontend and a FastAPI backend for supplier-portal support dialogs.

**Backend (`backend/`):** Python 3.14, uv, FastAPI, MongoDB & Beanie. Run from `backend/`. Settings live in `settings.yaml` (gitignored); schema is `src/config_schema.py` / `settings.schema.yaml`. Dialog answers come from the local topic catalog (`data/topic_catalog.json`) and Memvid BM25 (`data/knowledge.mv2`). No cloud embeddings, no web search, no raw PDFs to a model at request time. `line` stays `null` until `POST /dialogs/{id}/escalate`. `src/ingest/` notebooks are exploratory and are not loaded by the API.

**Frontend (`frontend/`):** React 19, TypeScript, Tailwind 4, Vite, pnpm. Alias `@/` → `frontend/src`. Name the typed React Query client `$api` at every call site (`frontend/src/api`). Use lowercase HTTP methods and the typed OpenAPI `init` object. Chat UI is Russian. Wire a real backend through `ChatTransport` in `frontend/src/features/chat/types.ts`; do not parse assistant prose for structure. Regenerate `frontend/src/api/types.ts` with `node scripts/gen-api.mjs` while the backend is running.

### Git

When finishing a task with code changes:
- stage only the relevant changes (not the full working tree / unrelated diffs); do not stage secrets (`.env`, credentials, local `settings.yaml`)
- draft a concise conventional commit message matching recent `git log` style (focus on why). **Always include a scope:**
  - `frontend` or `backend` when the change is local (e.g. `feat(frontend): …`, `fix(backend): …`)
  - comma-separated scopes when both are touched (e.g. `chore(frontend, backend): …`)
  - `general` for repo-wide changes (e.g. `chore(general): …`, `docs(general): …`)
- **Base the message on the full staged diff** (`git diff --cached` / all files being committed), not only the last edit in the chat. One commit = one message that covers the whole staged set.
- if the change is tied to a GitHub issue, put a trailer in the commit body: `Closes one-zero-eight/hackathon-tenderhack-nn-innosport#123` when the commit closes the issue, or `Relates one-zero-eight/hackathon-tenderhack-nn-innosport#123` when it only relates to it
- propose that message to the IDE Source Control input by writing it to `.scm-commit-msg` at the repo root (gitignored — do not stage it). Requires the SCM Commit Message extension (install once per machine into `~/.cursor/extensions/local.scm-commit-msg-from-file-*/`, then Reload Window). **An existing `.scm-commit-msg` is most probably a draft for earlier changes that were staged (or ready to stage) but not committed yet** — rewrite it so it covers the full set you are about to commit, do not treat it as only the latest chat edit. After an IDE commit the extension clears the SCM input only when it still matches `.scm-commit-msg`, then deletes the file. After a CLI commit, always `rm -f .scm-commit-msg` (the extension then clears the matching SCM input).
- do **not** run `git commit` unless the user explicitly asks

### Testing

Backend acceptance tests do not need live MongoDB. Frontend chat model tests use Node's built-in test runner.

```bash
cd backend && uv run pytest
cd frontend && pnpm test
```

When writing tests:
- prefer behavior and contract tests over implementation-detail tests
- use in-memory dialog stores/retrievers (`MemoryConversationStore`, `MemoryKnowledgeRetriever`); mock only external systems (llama.cpp)
- keep tests independent and parallel-safe
- run the relevant pytest / `pnpm test` command before claiming the change is complete
