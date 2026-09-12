# backend

## Table of contents

Did you know that GitHub supports table of
contents [by default](https://github.blog/changelog/2021-04-13-table-of-contents-support-in-markdown-files/) 🤔

## About

This is the FastAPI ASGI application.

### Technologies

- [Python 3.14](https://www.python.org/downloads/) & [uv](https://docs.astral.sh/uv/)
- [FastAPI](https://fastapi.tiangolo.com/)
- Database and ORM: [MongoDB](https://www.mongodb.com/) & [Beanie](https://beanie-odm.dev/)
- Formatting and linting: [Ruff](https://docs.astral.sh/ruff/), [pre-commit](https://pre-commit.com/)
- Deployment: [Docker](https://www.docker.com/), [Docker Compose](https://docs.docker.com/compose/),
  [GitHub Actions](https://github.com/features/actions)

## Development

### Set up for development

1. Install [uv](https://docs.astral.sh/uv/) and [Docker](https://docs.docker.com/engine/install/)
2. Install dependencies:
   ```bash
   uv sync
   ```
3. Start development server (and read logs in the terminal):
   ```bash
   uv run -m src.api --reload
   ```
   > Follow the provided instructions (if needed).
4. Open in the browser: http://localhost:8000
   > The api will be reloaded when you edit the code

> [!IMPORTANT]
> For endpoints requiring authorization click "Authorize" button in Swagger UI

> [!TIP]
> Edit `settings.yaml` according to your needs, you can view schema in
> [config_schema.py](src/config_schema.py) and in [settings.schema.yaml](settings.schema.yaml)

### Dialog API (support)

The backend answers supplier-portal tickets from a local topic catalog and the
single-file `data/knowledge.mv2` knowledge base. Retrieval is local Memvid BM25:
`find(..., mode="lex")`; no cloud embeddings or web search are used.

Knowledge sources live in the repo-root `docs/` directory (topic workbook +
instruction PDFs). Rebuild the catalog after changing those files:

```bash
uv run python scripts/build_knowledge_base.py
```

This writes `data/topic_catalog.json`. Topics come from
`docs/Темы_подтемы_обращений.xlsx` (86 subtopics). The separately built Memvid
file must be placed at `data/knowledge.mv2` (or the path set by
`knowledge_memvid_path`). Its hits should include `text` and metadata
`source`/`document`, `section`, `section_title`, and `path`; `topic_id` is
optional. Hits with incomplete citation metadata are rejected. Raw PDFs are
never sent to a model at request time.

For `memvid-sdk==2.0.160`, the ingestion code must call `enable_lex()` and
provide `search_text` as the lowercased chunk without punctuation, then
`commit()`. Keep source metadata in the same frame. Without `search_text` (or
when it contains sentence punctuation), the resulting file may report a
lexical index in `stats()` while `find(mode="lex")` raises the misleading
`LexIndexDisabledError`.

Conversations are stored in MongoDB (`conversations` collection). Create an
appeal, then post messages:

```bash
DIALOG_ID=$(http POST :8000/dialogs | jq -r .id)

http POST :8000/dialogs/$DIALOG_ID/messages content="Как зарегистрироваться поставщику на портале?"
http POST :8000/dialogs/$DIALOG_ID/messages content="вы идиоты, как подключить сертификат ЭП?"
http POST :8000/dialogs/$DIALOG_ID/messages content="уже не помогло, закупка 1234567890"
http POST :8000/dialogs/$DIALOG_ID/escalate
http GET :8000/dialogs/$DIALOG_ID
```

Equivalent curl:

```bash
curl -s -X POST http://localhost:8000/dialogs
curl -s -X POST http://localhost:8000/dialogs/$DIALOG_ID/messages \
  -H 'content-type: application/json' \
  -d '{"content":"Как зарегистрироваться поставщику на портале?"}'
```

Each message returns JSON with `reply`, `status` (`clarifying` | `answered` |
`escalate` | `closed_abuse`), `topic`, `line` (`L1` | `L2`),
`clarification_options` (catalog titles only), `citations`, `closed`, and
`reason`. Profanity closes the appeal using the local [djantimat](https://github.com/PixxxeL/djantimat)
Russian slang lexicon in `data/abuse/ru_profane_words.txt` (MIT; no network calls).
Rudeness without profanity is handled as a normal ticket.

The message loop never assigns a support line: `line` remains `null` while the
assistant answers or asks up to three catalog-backed clarifications. If the
knowledge base cannot support an answer, the dialog remains open and the user
may rephrase or choose a specialist. Only
`POST /dialogs/{id}/escalate` analyzes the accumulated user messages, assigns
L1/L2, and closes the handoff. Incidents, “уже не помогло”, personal cases, and
purchase/contract numbers select L2; ordinary cases select L1.

Optional local llama.cpp classifies topics and formulates answers from retrieved
Memvid chunks:

```yaml
llama_cpp:
  enabled: true
  base_url: http://127.0.0.1:8080   # or http://192.168.x.x:8080
  model: ""                         # leave empty to use the model loaded by llama-server
  timeout_seconds: 8
  max_tokens: 96
  answer_max_tokens: 600
```

Example server on this machine (the API does not download a model):

```bash
llama-server --host 0.0.0.0 --port 8080 --model /path/to/local.gguf
```

The model must return JSON with `can_answer`, `answer`, and Memvid frame IDs.
The backend rejects unknown citations and answers with insufficient lexical
grounding. If llama.cpp is down or its answer is rejected, the backend uses an
extractive answer from the same chunks; if retrieval has no support, it offers
a specialist instead of inventing information.

`src/main.ipynb` and `src/ingest.ipynb` are exploratory notebooks and are not
loaded by the API. In particular, their old OpenAI/semantic examples are not
part of the production path.

Acceptance tests (no live MongoDB):

```bash
uv run pytest
```

**Set up PyCharm integrations**

1. Run configurations ([docs](https://www.jetbrains.com/help/pycharm/run-debug-configuration.html#createExplicitly)).
   Right-click the `__main__.py` file in the project explorer, select `Run '__main__'` from the context menu.
2. Ruff ([plugin](https://plugins.jetbrains.com/plugin/20574-ruff)).
   It will lint and format your code. Make sure to enable `Use ruff format` option in plugin settings.
3. Pydantic ([plugin](https://plugins.jetbrains.com/plugin/12861-pydantic)). It will fix PyCharm issues with
   type-hinting.
4. Conventional commits ([plugin](https://plugins.jetbrains.com/plugin/13389-conventional-commit)). It will help you
   to write [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/).

### Deployment

We use Docker with Docker Compose plugin to run the service on servers.

1. Copy the file with environment variables: `cp .example.env .env`
2. Change environment variables in the `.env` file
3. Copy the file with settings: `cp settings.example.yaml settings.yaml`
4. Change settings in the `settings.yaml` file according to your needs
   (check [settings.schema.yaml](settings.schema.yaml) for more info)
5. Install Docker with Docker Compose
6. Run the containers: `docker compose up --build --wait`
7. Check the logs: `docker compose logs -f`

## FAQ

### Be up to date with the template!

Check https://github.com/one-zero-eight/fastapi-template for updates once in a while.

### How to update dependencies

1. Run `uv sync --upgrade` to update uv.lock file and install the latest versions of the dependencies.
2. Run `uv tree --outdated --depth=1` will show what package versions are installed and what are the latest versions.
3. Run `uv run prek auto-update`

Also, Dependabot will help you to keep your dependencies up-to-date, see [dependabot.yaml](.github/dependabot.yaml).

### How to dump the database

1. Dump:
   ```bash
   docker compose exec db sh -c 'mongodump "mongodb://$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@127.0.0.1:27017/db?authSource=admin" --db=db --out=dump/'
   ```
2. Restore:
   ```bash
   docker compose exec db sh -c 'mongorestore "mongodb://$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@127.0.0.1:27017/db?authSource=admin" --drop /dump/db'
   ```


## Contributing

We are open to contributions of any kind.
You can help us with code, bugs, design, documentation, media, new ideas, etc.
If you are interested in contributing, please read
our [contribution guide](https://github.com/one-zero-eight/.github/blob/main/CONTRIBUTING.md).
