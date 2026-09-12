# ИИ-помощник

> by InNoHassle

## About

ИИ-помощник is a supplier-portal support chat for [TenderHack NN](https://github.com/one-zero-eight/hackathon-tenderhack-nn-innosport): a Russian-language frontend and a FastAPI backend that answers tickets from a local topic catalog and Memvid BM25 knowledge base. Optional local llama.cpp classifies topics and drafts grounded answers. Specialist handoff assigns L1 or L2; the message loop never invents unsupported answers.

The frontend is built with React, TypeScript, Tailwind CSS, and Vite. The backend is Python 3.14, uv, FastAPI, MongoDB, and Beanie.

Testing guidelines are in [TESTING.md](TESTING.md). Parallel git worktrees are in [WORKTREE.md](WORKTREE.md). Agent conventions are in [AGENTS.md](AGENTS.md).

## Stack

- React 19
- TypeScript
- Tailwind CSS 4
- Vite
- pnpm

## Getting started

```bash
cd frontend
pnpm install
pnpm dev
```

The development server uses Vite's default address at `http://localhost:5173`.

## Production build

```bash
cd frontend
pnpm build
pnpm preview
```

The application entry point is `frontend/src/app/main.tsx`, and reusable
components live under `frontend/src/components`.

## Chat frontend

The main page is a Russian-language chat UI built on the existing Button, Input,
ThemeToggle and Tailwind theme tokens. It includes chat history/search, an in-chat
clarification form, message navigation, and a specialist contact action after
three successfully submitted clarification replies in the current chat.

**The current application uses a clearly labelled local demo, not an LLM.** The
scripted transport asks three clarification questions and gives a sample answer.
Specialist handoff is simulated and labelled as such next to its confirmation;
no real specialist request is sent. No backend endpoints have been added or assumed.

Clarification questions remain visible after they are answered. An appeal can be
closed and reopened without losing history. Closed appeals reject new messages
and clarification replies. Specialist handoff and closing prompt for feedback
only when there is an explicitly typed substantive answer (`kind: 'answer'`), not
just clarification or routing messages. Negative ratings optionally include a
reason; one rating is stored per appeal and is not re-requested on reopening.
Feedback is local-only, including for closed appeals. Closing does not cancel an
existing specialist handoff.

- UI: `frontend/src/components/chat/`
- Typed frontend transport boundary: `frontend/src/features/chat/types.ts`
- Demo transport: `frontend/src/features/chat/demo-transport.ts`
- State and storage: `frontend/src/features/chat/useChat.ts`

Chat history is saved under `support.chat.v1` in browser localStorage. Do not
enter sensitive data; clearing this key removes saved chats. Drafts stay in memory
per chat. Storage failures fall back to in-memory operation. The stored payload
is now version 2; valid version 1 conversations are migrated in place as open
appeals. Legacy untyped bot messages are not assumed to be substantive answers.

To integrate a real service, implement `ChatTransport` and pass it to `useChat`.
Use the `$api` convention below, and map structured clarification data rather than
matching phrases in generated text. Update the demo labels and specialist action
only after their real service contracts are connected.

Run state tests (Node 22.18+ or a newer version supporting native TypeScript stripping):

```bash
cd frontend
pnpm test
```

## API query convention

Name the typed React Query client `$api` at every call site. Use the existing
wrapper in `frontend/src/api/create-query-client.ts` through these interfaces:

```ts
$api.useQuery(method, path, init, options)
$api.useMutation(method, path, options)
$api.queryOptions(method, path, init, options)
```

Use lowercase HTTP methods and pass request parameters through the typed
OpenAPI `init` object. The API base URL and endpoint schema will be configured
when the backend specification is available.

## Team

| Member                                              | Role |
| --------------------------------------------------- | ---- |
| [mikyss](https://github.com/PoweredDeveloper)       | Fullstack + ML |
| [Artem Bulgakov](https://github.com/ArtemSBulgakov) | Role |
| [Nikita Lisitskii](https://github.com/keamka)       | Frontend |
| [Dmitry Bevz](https://github.com/mainStorne)        | Role |
