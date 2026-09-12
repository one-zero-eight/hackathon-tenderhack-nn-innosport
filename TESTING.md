## Testing

### Main principle

Write tests that verify user-visible behavior and service contracts, not incidental implementation details.

Prefer realistic integration tests when they are practical. Use mocks only at system boundaries: external APIs, third-party services, and nondeterministic or external network dependencies.

### Running tests

Backend dialog tests use in-memory stores and retrievers. They do not need live MongoDB.

```bash
cd backend && uv run pytest
```

Frontend chat model and transport tests use Node's built-in test runner (Node 22.18+):

```bash
cd frontend && pnpm test
```

Useful pytest variants (from `backend/`):

```bash
uv run pytest --lf
uv run pytest -k "some expression"
uv run pytest tests/path/to/test_file.py
uv run pytest tests/path/to/test_file.py::test_name
uv run pytest -n auto --dist=loadscope
uv run pytest --cov=src --cov-report=term-missing
```

Useful frontend variants (from `frontend/`):

```bash
pnpm test -- src/features/chat/model.test.ts
pnpm test -- src/features/chat/api-transport.test.ts
```

MongoDB is for running the API locally, not for the default pytest suite. If you need the database for manual checks:

```bash
docker compose up --wait database
```

### Test design

Good tests should be:

* independent from test order
* explicit about expected behavior
* small enough to identify the broken feature
* realistic enough to catch integration bugs
* stable under parallel execution

Avoid tests that depend on hidden global state, production services, arbitrary sleeps, or exact ordering unless ordering is part of the API contract.

### Infrastructure

Use existing fixtures (`tests/modules/dialog/conftest.py`: `make_service`, `make_client`, `MemoryConversationStore`, `MemoryKnowledgeRetriever`). Do not start databases, object stores, or service containers inside individual tests.

Tests should run against test settings only. Never hardcode production credentials, URLs, buckets, databases, or tokens.

When parallel test execution is enabled, assume multiple workers may run tests at the same time. Use isolated names, unique test data, or existing cleanup fixtures.

### Mocking

Mock external systems, not the code under test.

Acceptable mock targets include:

* llama.cpp / HTTP to a local model server
* external HTTP APIs
* authentication providers
* third-party services
* time-sensitive or nondeterministic boundaries

Avoid mocking internal repositories, services, or business logic when the behavior can be tested through the public API. Prefer `NullLlamaClient` or a fake client passed into `DialogService`.

### Assertions

Assert outcomes, not implementation steps.

Prefer:

```python
assert response.status_code == 409
assert response.json()["closed"] is True
```

Over:

```python
assert some_internal_function_was_called
```

For successful responses, assert the fields that define correctness. Avoid asserting entire payloads when only a few fields matter.

### Test data

Use clear, minimal test data.

When creating persistent records, files, buckets, objects, slugs, or IDs, make them unique unless the test specifically verifies conflicts.

Do not rely on data created by another test.

### External network

Tests must not call real external services. All external network interactions should be mocked, stubbed, or routed through controlled test infrastructure. Do not call a live llama.cpp server from pytest.

### Debugging

For visible output:

```bash
cd backend && uv run pytest -s
```

For verbose output:

```bash
cd backend && uv run pytest -vv
```

For one failing test:

```bash
cd backend && uv run pytest tests/path/to/test_file.py::test_name -vv -s
```

### Coverage

Coverage is useful for finding untested areas, but it is not the goal by itself.

Prefer meaningful tests for important behavior over shallow tests written only to increase coverage numbers.

### Commit messages

Use `test(frontend): …`, `test(backend): …`, or `test(general): …` when adding or updating only tests or test infrastructure.
