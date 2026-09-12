# Git worktrees

Use worktrees to work on several branches in parallel without stashing or switching in the main checkout.

## Layout

```text
hackathon-tenderhack-nn-innosport/      # main worktree — owns backend/settings.yaml
├── backend/settings.yaml               # gitignored local config
└── frontend/

hackathon-tenderhack-nn-innosport-<name>/   # extra worktree — uses SETTINGS_PATH
```

Sibling directories next to the main checkout, not inside it.

## Create a worktree

From the main checkout:

```bash
# new branch
git worktree add ../hackathon-tenderhack-nn-innosport-<name> -b <branch>

# existing branch
git worktree add ../hackathon-tenderhack-nn-innosport-<name> <branch>

git worktree list
```

Then in the new worktree:

```bash
cd ../hackathon-tenderhack-nn-innosport-<name>
cd backend && uv sync && cd ..
cd frontend && pnpm install && cd ..
```

Git hooks from `prek install` already live in the shared `.git/hooks` of the main repo — no need to reinstall per worktree. `SETTINGS_PATH` should already point at the main worktree `backend/settings.yaml`.

## Remove a worktree

```bash
# from main repo
git worktree remove ../hackathon-tenderhack-nn-innosport-<name>

# if the directory was deleted manually
git worktree prune
```

`.venv` and `frontend/node_modules` inside the removed worktree go away with the directory. Main-worktree `backend/settings.yaml` stays.

## Share config via `SETTINGS_PATH`

The backend loads settings from `SETTINGS_PATH`, defaulting to `./settings.yaml` (relative to the `backend/` working directory):

```python
Path(os.getenv("SETTINGS_PATH", "settings.yaml"))
```

Keep a single `settings.yaml` in the **main** worktree `backend/`. From that directory, export an absolute path (so other worktrees can reuse it):

```bash
# from main repo backend/
export SETTINGS_PATH="$(pwd)/settings.yaml"
```

Persist it in your shell rc, direnv, or IDE run config so every worktree picks it up.

Examples (with `SETTINGS_PATH` already exported):

```bash
# pytest
cd backend && uv run pytest

# API (from backend/)
uv run -m src.api --reload

# parallel worktrees / agents: override port so instances do not clash
uv run -m src.api --reload --port 18000
cd frontend && pnpm dev -- --port 15173
```

Use a non-default host port per worktree (or per agent) when running the same API or Vite app in parallel. Point the extra frontend at its backend (`VITE_DEV_PROXY_TARGET=http://127.0.0.1:18000` if you changed the API port).

Prefer one shared `settings.yaml` via `SETTINGS_PATH`. Exception: schema drift (below).

## Schema drift between worktrees

Shared `SETTINGS_PATH` means **one** file. If a branch changes the pydantic settings schema (`backend/settings.example.yaml` / `backend/src/config_schema.py`) and the shared file no longer validates:

1. **Additive / still compatible** (new optional fields with defaults): update the shared `settings.yaml` once (diff against that branch’s `settings.example.yaml`). Other worktrees keep working.
2. **Breaking** (renamed/removed/required fields): stop sharing for that worktree:
   ```bash
   # in the diverging worktree
   unset SETTINGS_PATH
   cp ../hackathon-tenderhack-nn-innosport/backend/settings.yaml ./backend/settings.yaml
   # or from backend/: uv run python -c "from src.prepare import ensure_settings_file; ensure_settings_file()"
   # edit local backend/settings.yaml for the new schema
   ```
   Run that worktree against `./backend/settings.yaml` until the branch merges. Then fold needed keys back into the main `settings.yaml` and restore `SETTINGS_PATH`.

Do not keep two long-lived divergent shared files — that defeats the point of `SETTINGS_PATH`.

## Do not share `.venv` or `node_modules`

Create a separate virtualenv in each worktree with `uv sync` in `backend/`, and a separate `pnpm install` in `frontend/`.

Reasons:

- venv embeds absolute paths
- branches may differ in lockfile / dependencies
- editable installs point at a specific source tree
- `node_modules` is not portable across checkouts

Package caches (`~/.cache/uv`, pnpm store) are already shared — that is enough.

## Docker

Options:

1. **Preferred:** set up infra from the **main** worktree (`docker compose up --wait database`). Use extra worktrees for code + `uv run` / `pnpm dev` with `SETTINGS_PATH`.
2. **Isolated stack in an extra worktree:** either place/copy a `settings.yaml` there for the mount, or run Compose only from main. If you spin a second stack, use a distinct project name, e.g. `COMPOSE_PROJECT_NAME=innosport-foo`. However, most probably it is not needed as we prefer to run the API and Vite locally on the host.
