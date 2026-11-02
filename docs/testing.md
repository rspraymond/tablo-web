# Testing

Where tests live in tablo-web and how to add new ones. The suites follow the testing pyramid: many fast unit tests, a few component tests, no E2E yet.

## Layers

| Layer | Where | What it covers | Example in this repo |
|---|---|---|---|
| Unit (backend) | `backend/tests/test_<domain>.py` | Route handlers via FastAPI `TestClient`: happy path plus error mapping per endpoint | `test_state_fields.py` |
| Unit (frontend) | `frontend/src/__tests__/*.test.ts` | Pure logic in `src/lib/`: transformations, validation, boundary math | `filters.test.ts`, `volume.test.ts` |
| Component (frontend) | `frontend/src/__tests__/*.test.tsx` | One component's observable behavior: rendered output, user events, DOM state | `video-player.test.tsx` |
| E2E | n/a | None yet; critical journeys are checked manually (see the Backpressure validation section in AGENTS.md for what to verify) | n/a |

## Where to add a test

- **Backend route change** → extend the matching `backend/tests/test_<domain>.py`. Mock at the HTTP boundary (`state.request_device`, cloud fetches), never the real network or device.
- **New pure logic** → extract it to `frontend/src/lib/` (like `filters.ts` and `volume.ts`) and add a matching `__tests__/<name>.test.ts`.
- **Component behavior** → add `__tests__/<component>.test.tsx` that renders the component and asserts observable DOM state.
- **Flow-control bound change** → follow the Backpressure validation rules in AGENTS.md.

## Frontend component tests

- Environment is jsdom with globals enabled (configured in `frontend/vite.config.ts`).
- Mock the API module so no real fetch happens:

  ```tsx
  vi.mock("../api/tablo", () => ({
    api: { startStream: vi.fn(), stopStream: vi.fn() },
  }));
  ```

- Set mock results in `beforeEach` with `vi.mocked(api.startStream).mockResolvedValue(...)`.
- Assert observable state (`video.muted`, rendered text, slider value), not internal state, refs, or call order.
- Full working example: `frontend/src/__tests__/video-player.test.tsx`.

## Decision guide

| If you are... | Prefer... |
|---|---|
| Testing a calculation, parser, or filter | A unit test against a `src/lib/` helper |
| Testing what a component renders or how it responds to events | A component test with Testing Library; mock only the API boundary |
| Testing an endpoint's status codes and payloads | A `TestClient` test in the matching `test_<domain>.py` |
| Testing a concurrency cap or timeout | The backpressure patterns in AGENTS.md (in-flight counter, hung mock) |

## Running

```bash
cd backend && python -m pytest tests/ -v
cd frontend && npm test
```