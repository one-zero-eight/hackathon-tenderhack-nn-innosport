# InnoSport

> by InNoHassle

InnoSport is built with React, TypeScript, Tailwind CSS, and Vite.

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
scripted transport asks three clarification questions. The contact dialog explains
that no request is sent. No backend endpoints have been added or assumed.

- UI: `frontend/src/components/chat/`
- Typed frontend transport boundary: `frontend/src/features/chat/types.ts`
- Demo transport: `frontend/src/features/chat/demo-transport.ts`
- State and storage: `frontend/src/features/chat/useChat.ts`

Chat history is saved under `innosport.chat.v1` in browser localStorage. Do not
enter sensitive data; clearing this key removes saved chats. Drafts stay in memory
per chat. Storage failures fall back to in-memory operation.

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
