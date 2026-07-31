# Cowork BTW Side Question Design

## Background

OpenClaw `v2026.6.1`, the version currently pinned by LobsterAI, supports
`/btw <question>` and its `/side` alias as ephemeral side questions. A BTW
request uses the current session as background context, runs independently from
the main turn, and returns a live `chat.side_result` event without writing the
question or answer to transcript history.

LobsterAI does not currently expose that behavior correctly:

- Cowork sends prompt input through the normal `continueSession` path.
- Normal input is written to the local message store before `chat.send`.
- A running Cowork turn causes normal input to be queued or rejected instead of
  being sent immediately as a side question.
- `OpenClawRuntimeAdapter` handles `chat` and `agent` events but ignores
  `chat.side_result`.
- The empty `chat` final emitted after a BTW result is not distinguished from a
  normal turn final.

As a result, forwarding `/btw ...` through the existing path can pollute local
history, fail during an active turn, or complete without displaying the answer.

## Goals

- Support `/btw <question>` and `/side <question>` in an existing Cowork
  session.
- Send a BTW request immediately while the main turn is idle or running.
- Keep the main turn, its tools, session status, and queued follow-ups
  unchanged.
- Render BTW questions and answers in an application-internal floating side-chat
  window with a fixed default rectangular size.
- Place the window above and right-aligned with the main prompt initially,
  falling back to the bottom-right corner when that anchor is unavailable,
  then allow dragging and resizing while keeping it inside the visible
  application viewport.
- Represent selected assistant text as a removable excerpt tag above the
  editable side-chat input without sending until the user explicitly submits
  it.
- Let the user stop only the pending side-chat request without stopping or
  changing the main task.
- Support continued side-chat questions by carrying a bounded window of recent
  side-chat answers into each new one-shot OpenClaw BTW request.
- Keep BTW questions and answers out of Cowork messages, SQLite conversation
  history, titles, continuity capsules, and OpenClaw `chat.history`.
- Use OpenClaw's existing `chat.send` command handling and `chat.side_result`
  contract, with a version-scoped compatibility patch for the pinned runtime's
  provider run-safety integration.
- Never expose provider-internal tool-call markup such as DeepSeek DSML,
  MiniMax XML, Grok-style tool lines, or generic tool-call XML as a visible BTW
  answer.
- Preserve session and agent isolation when multiple Cowork sessions are open
  or syncing from external channels.
- Add Chinese and English strings for all BTW UI and error states.

## Non-Goals

- BTW is not a normal follow-up, queued follow-up, or same-turn steer.
- BTW does not alter Plan mode, Goal mode, selected skills, selected kits, or
  the active working directory.
- The first version does not extend the main/preload/runtime BTW contract with
  structured selected-text metadata, attachments, browser annotations, media
  generation options, or voice input. Renderer state keeps the excerpt
  structured for display and re-editing, then formats it as bounded,
  prompt-injection-safe quoted side-question text before IPC submission.
- The first version does not persist BTW threads across renderer reloads or app
  restarts.
- The side-chat window is not a durable or OpenClaw-native thread. Follow-up
  continuity is assembled from bounded renderer-memory entries and supplied to
  each independent `/btw` request.
- This design does not make the non-Codex direct BTW fallback tool-capable.
  Tool execution for that path is a separate runtime feature, not a renderer
  protocol-parsing task.
- The renderer must not parse or execute raw model-generated tool-call text.
  Doing so would bypass OpenClaw's tool policy, sandbox, approval, timeout, and
  audit boundaries.
- LobsterAI does not reimplement OpenClaw's context snapshot, model selection,
  tool policy, or provider-specific BTW behavior.
- External IM rendering remains owned by OpenClaw channel integrations. This
  design covers the Cowork desktop surface.

## OpenClaw Contract

For a valid existing session, LobsterAI sends:

```text
/btw <question>
```

through Gateway `chat.send` with `deliver: false` and a dedicated idempotency
key. OpenClaw:

1. snapshots the current session context, including an in-flight main prompt;
2. runs an independent one-shot side query;
3. leaves the active main run untouched;
4. emits `chat.side_result`;
5. emits an empty normal `chat` final for the BTW run;
6. does not append the BTW question or answer to transcript history.

The side-result payload in the pinned runtime contains:

```ts
interface OpenClawBtwSideResultPayload {
  kind: 'btw';
  runId: string;
  sessionKey: string;
  agentId?: string;
  question: string;
  text: string;
  isError?: boolean;
  ts: number;
  seq?: number;
}
```

`/btw` requires an existing OpenClaw session and transcript context. A new
Cowork draft must send at least one normal message before BTW becomes
available. The side query is a separate model invocation and can consume
additional provider tokens even though it does not change the future context.
OpenClaw does not retain the answer as a native side thread. LobsterAI keeps
the visible temporary exchanges in renderer memory and includes recent
answered exchanges in a later request as bounded single-line context so
follow-up questions can refer to them.

The pinned runtime registers and resolves BTW provider streams with
`ProviderStreamPurpose.Utility`. Utility fallbacks must not be promoted to an
Agent boundary-aware stream because BTW does not own the host Agent dispatch
scope required by that stream contract. The resolver defaults every caller
without an explicit purpose to `Agent`, preserving the main task, compaction,
and other embedded-agent run-safety paths.

## Tool Capability, Protocol Leakage, and Runtime Safety Analysis

This section records the source-level conclusions verified against the pinned
OpenClaw `v2026.6.1` runtime on 2026-07-30.

The relevant implementation points are OpenClaw's `src/agents/btw.ts`,
`extensions/codex/src/app-server/side-question.ts`,
`src/gateway/server-methods/chat.ts`, provider transport filters and the shared
user-facing sanitizer, plus LobsterAI's
`src/main/libs/agentEngine/openclawRuntimeAdapter.ts`.

### Capability Is Selected by Runtime Path

BTW tool support is not determined solely by whether a model can call tools in
a normal Agent turn.

| Runtime path | BTW implementation | Tool and file behavior |
| --- | --- | --- |
| Codex native harness | Forks an ephemeral Codex app-server side thread | Keeps the current Codex sandbox, approval policy, native tools, and bridged OpenClaw tools. It may read files and may perform an explicitly requested mutation when policy permits. |
| Non-Codex providers, including DeepSeek, Qwen, and Ollama | Uses the direct one-shot provider fallback | Intentionally tool-less. It can answer from captured context but cannot perform a new `read`, `write`, `exec`, or other OpenClaw tool operation. |
| Normal Cowork Agent turn | Uses the normal embedded/native Agent loop | Keeps the existing structured tool execution and LobsterAI tool UI. It is unaffected by the BTW fallback restriction. |

Therefore, the same DeepSeek or Qwen model may execute tools in the main Cowork
conversation but not through `/btw`. This is an OpenClaw BTW execution-path
limitation, not a general model capability limitation and not evidence that
LobsterAI failed to subscribe to a structured BTW tool event.

The `chat.side_result` payload contains final `text` and no tool-call or
tool-result fields. Codex BTW may execute tools internally and still return
only the final text. A structured side-tool protocol is needed only if the
floating window must display live tool progress, results, approvals, or
failures.

### Observed Tool-Protocol Leakage

The observed failure renders provider protocol text similar to:

```text
<|DSML|tool_calls>...<|DSML|invoke name="read">...</|DSML|tool_calls>
```

This is not a Markdown rendering bug and does not mean a `read` succeeded. The
failure sequence is:

1. a non-Codex BTW question asks for work that requires a tool;
2. the direct fallback exposes no tools or Agent tool loop;
3. the model nevertheless emits a pseudo-tool call in provider-specific text;
4. the fallback returns that text through `chat.side_result.text`;
5. LobsterAI correctly routes the final text to the matching ephemeral entry;
6. the Markdown renderer displays it because Markdown sanitization is not
   model-protocol sanitization.

The non-Codex fallback prompt currently says not to emit tool calls unless the
side question explicitly asks for them. That exception is ambiguous for a
tool-less path and can encourage a pseudo-tool call when the user explicitly
asks to read or modify a file. The fallback instruction should instead state
unconditionally that it cannot emit or execute tools and should return a
concise capability message when a fresh tool operation is required.

### Reuse of the Main Conversation Safety Pipeline

The main Agent path provides the reference architecture:

- native provider tool calls are normalized into structured OpenClaw tool
  events;
- DeepSeek DSML recovery/filtering is provider-specific and is enabled by the
  OpenAI-compatible transport's DeepSeek compatibility metadata;
- the shared `sanitizeUserFacingText` boundary removes known residual MiniMax,
  Grok, legacy bracket, generic `<tool_call>`, and function-call markup;
- LobsterAI consumes normalized Agent tool start/update/result events rather
  than parsing assistant prose.

There is no safe universal parser that can execute every provider's private
text protocol. The common handling strategy is layered:

1. provider-specific transport normalization for executable structured calls;
2. a provider-agnostic final sanitizer for known residual control markup;
3. a LobsterAI main-process display guard for older, unknown, or incompatible
   runtime output.

DeepSeek DSML should be factored into the shared user-visible sanitization
boundary rather than implemented as a renderer-only special case. Coverage
must include ASCII and full-width bar variants, split and truncated blocks,
MiniMax, Grok, legacy bracket blocks, and generic tool/function-call XML.
Literal protocol examples in inline or fenced code must remain visible when
the user is discussing the syntax.

### How Codex Native BTW Handles Tool Runtime Concerns

The Codex harness implements substantially more than the non-Codex fallback:

1. **Independent temporary execution**
   - It forks the active Codex thread with `ephemeral: true`.
   - It injects an explicit side-conversation boundary and starts a separate
     turn with the same model and working directory.
   - Parent history is reference context only; the side turn does not append
     its question or answer to the parent transcript.
2. **Sandbox and approval**
   - It inherits the parent binding's `sandbox` and `approvalPolicy`.
   - It resolves the OpenClaw coding-tool catalog through the same sandbox
     context and bridges dynamic tool calls back to OpenClaw.
   - App-server approval requests are handled through the existing approval
     bridge. Auto-approval is derived from the effective sandbox and approval
     policy.
   - Developer instructions allow mutation only when the new side question
     explicitly requests it. This prompt is guidance; sandbox and approvals
     remain the actual enforcement boundary.
3. **Stop, timeout, and cleanup**
   - The upstream abort signal propagates into the side run and every bridged
     dynamic tool call.
   - Dynamic tools have bounded timeouts: 90 seconds by default, specialized
     media timeouts where configured, and a hard maximum of 600 seconds.
   - Waiting for the side turn also has a bounded completion timeout.
   - Final cleanup removes listeners and request handlers, aborts remaining
     tool work, interrupts an unfinished side turn, unsubscribes the child
     thread, releases the leased app-server client, and unregisters the native
     hook relay.
   - LobsterAI's stop button calls `chat.abort` with the exact BTW run id; the
     resulting abort signal is independent from the main Cowork turn.
4. **Tool lifecycle and approvals**
   - Codex internally handles dynamic tools and relays pre-tool, post-tool,
     permission-request, and before-finalize hooks.
   - The current Gateway BTW client contract still publishes only the final
     `chat.side_result.text`.
   - `OpenClawRuntimeAdapter` intentionally suppresses Agent events correlated
     to a BTW run, so the LobsterAI floating window currently shows neither
     tool progress nor tool result cards.

### Remaining Codex BTW Gap: Concurrent Workspace Mutation

Codex BTW does not provide a file lock, workspace snapshot, transaction,
automatic merge, or conflict detector between the parent turn and the side
turn. Both can use the same `cwd`.

OpenClaw reduces risk through side-boundary instructions that prefer
lightweight, non-mutating exploration and require an explicit side request
before mutation. This is not hard concurrency isolation. If a user explicitly
asks the side turn to modify a file while the main turn writes the same
workspace, last-writer-wins behavior or inconsistent reads remain possible.

Any future non-Codex tool-capable BTW implementation must make an explicit
product decision:

- start with read-only tools;
- serialize mutating side tools against main-turn mutations;
- use a snapshot/worktree and merge deliberately; or
- allow concurrent writes with a visible warning and conflict detection.

The current feature should not imply that OpenClaw already solves this
concurrency problem.

### Recommended Near-Term Handling

The immediate fix is protocol hygiene, not renderer-side tool execution:

1. patch the pinned OpenClaw fallback to use an unconditional no-tool prompt;
2. apply the shared user-visible-text sanitizer before returning direct BTW
   text and extend that boundary for DSML;
3. preserve remaining visible prose but treat a tool-only response as a stable
   tool-required failure;
4. add a LobsterAI main-process defense that replaces residual protocol markup
   with localized guidance to continue in the main conversation;
5. log only marker family, run/session identity, and before/after character
   counts, never the raw prompt, path, arguments, or answer;
6. keep the renderer as a presentation layer and never execute parsed markup.

If provider-independent localized copy requires a protocol field, prefer an
optional stable error code such as `tool_required` over matching an English
backend error string. Older runtimes remain compatible through the
main-process fallback.

### Future Tool-Capable Non-Codex BTW

If the product later requires non-Codex BTW to use tools, replace the direct
provider fallback with an independent ephemeral Agent tool loop that inherits
the model, cwd, tool policy, sandbox, and approvals while owning separate
abort, timeout, cleanup, and lifecycle state.

Returning only the final answer can continue to use `chat.side_result.text`.
Displaying tool progress, results, or approvals requires side-run-correlated
structured events and a dedicated LobsterAI side-tool UI. Parsing DSML or
other raw text in the renderer is not an acceptable substitute.

## Product Behavior

### Command Detection

Cowork recognizes `/btw <question>` and `/side <question>` case-insensitively
when submitted from the normal composer.

- Detection happens before the running-turn queued-follow-up branch.
- `/side` is normalized to `/btw` before sending to OpenClaw.
- An empty question shows usage guidance and is not sent.
- A BTW command in explicit Goal or Steer input mode follows that selected
  mode instead of being reinterpreted.
- Plan mode may remain selected, but its system prompt is not applied to the
  BTW request.
- Existing attachments and selected capabilities remain in the normal draft
  and are not consumed by the BTW submission.
- Selecting assistant text shows an `Ask in side chat` action next to the
  existing `Add to chat` action. It opens the floating window and places the
  selected excerpt in the same removable, expandable tag UI used by the main
  composer while leaving the text input independently editable. The user can
  add a question or submit the selected excerpt directly. Additional selections
  append to the tag while the side-chat window remains open and preserve any
  independently typed draft. Opening from a new selection after the window was
  closed starts with that new excerpt instead of reviving stale unsent excerpts.

The slash-command composer follows the pinned runtime's single-line command
grammar and rejects multiline command input instead of falling through to
normal chat. The floating window accepts multiline editing and collapses
whitespace only when preparing the request. The product does not impose or
display a BTW question character limit. The OpenClaw adapter still applies the
shared `chat.send` frame-size guard before transport, and follow-up history is
bounded independently so it cannot grow with the editable question. Session
and run identifiers remain limited to 512 characters, and gateway session keys
are rejected above 4,096 characters.

### Floating Side-Chat Window

The current session displays an application-internal floating window outside
the normal message-list persistence model.

- Its default geometry is a 430 × 450 rectangular window positioned 16 pixels
  above and right-aligned with the main prompt input. If the prompt anchor is
  unavailable, it falls back to the application viewport's bottom-right
  corner. Reopening the window recalculates this default geometry within the
  current viewport.
- The title bar is a pointer drag handle. Invisible hit regions on all four
  edges and all four corners resize the window without a permanent resize
  icon.
- The entire floating window is an Electron `no-drag` region. Its title bar
  uses renderer pointer events for panel movement, so overlapping an
  application title-bar drag region does not move the native application
  window or make panel dragging less responsive.
- Width, height, and coordinates are clamped to the current viewport. Window
  resize or display-resolution changes automatically bring the full window
  back into view.
- The message area independently scrolls and renders completed answers with
  the existing sanitized Markdown renderer. Runtime and main-process protocol
  sanitization happens before Markdown rendering; the renderer does not infer,
  execute, or repair provider tool protocols.
- The window reuses the main conversation's theme tokens, borders,
  rounded-input, and send-button treatments. Its shell uses the elevated
  `surface` layer, and the composer uses the same lighter `surface` layer
  instead of the theme's darker canvas background. The composer's border and
  shadow preserve separation from the footer. A modal-level shadow and subtle
  outline keep the window distinct when it overlaps the conversation,
  especially in dark themes.
- User question bubbles are right-aligned, shrink to short content, and are
  capped at 85% of the message-area width so short questions do not look like
  full-width banners. Submitted excerpt tags remain visible inside their
  question bubbles.
- Hovering or keyboard-focusing a question reveals the same copy and re-edit
  actions used by the main conversation. Re-editing restores both the submitted
  excerpt tag and question draft, focuses the composer, and never mutates or
  resubmits the historical exchange.
- Hovering or keyboard-focusing an answered assistant message reveals the main
  conversation's copy action. Clipboard failures use the shared renderer
  fallback and diagnostic path.
- The footer contains the shared selected-text tag UI above a multiline
  editable input. The tag can be expanded, located, or removed. Enter submits
  and Shift+Enter inserts a line break; a tag can be submitted without
  additional input. The request is normalized to OpenClaw's single-line
  command grammar only at submission.
- While a side question is pending, the send action becomes a stop action.
  Stopping calls Gateway `chat.abort` with the exact side-question
  `sessionKey` and `runId`, records an ephemeral `stopped` result, and never
  calls the Cowork main-task `stopSession` path.
- Closing hides the window but keeps its draft and exchanges in renderer
  memory. Reopening without a new selection restores the draft and excerpt tag
  until reload or restart. While the window remains open, additional selected
  excerpts are appended subject to the shared count, duplicate, and size
  limits. Opening from selected text after closing replaces only the stale
  excerpt tags and preserves the independently typed draft.

Each session owns one temporary side-chat thread with multiple exchanges. Only
one request per session may be pending. The user can send another question
after it settles. Follow-up requests include the newest answered exchanges
that fit within a 16,000-character history-context budget; the current question
is never truncated by that budget. Failed and pending exchanges are excluded
from continuity context.

Switching sessions does not move a window or its content to another session.
Deleting the session removes the thread. Each thread is capped at 50 exchanges
and 500,000 characters, and at most 12 inactive threads are retained across
sessions. Old completed exchanges/threads are removed first and pending
requests are never evicted. Individual answers remain capped at 120,000
characters before they cross into the renderer. Editable drafts are not
truncated; if one completed exchange alone exceeds the renderer history budget,
it is retained while older completed exchanges are evicted.

### Running-Turn Behavior

Submitting BTW while the main turn is active:

- does not enter the queued-follow-up list;
- does not enter Steer mode or call `sessions.queueSteer`;
- does not change the session's `running` status;
- does not create or replace the main active-turn record;
- does not reset the main turn timeout watchdog;
- does not interrupt tool execution or permission handling.

The empty `chat` final belonging to the BTW run is consumed by the BTW
lifecycle and must never finalize, reconcile, retry, or error the main turn.

## Architecture

### Shared Types and Constants

Add `src/shared/cowork/btw.ts` with centralized `as const` values and derived
types:

```ts
export const CoworkBtwStatus = {
  Pending: 'pending',
  Answered: 'answered',
  Failed: 'failed',
} as const;
export type CoworkBtwStatus =
  typeof CoworkBtwStatus[keyof typeof CoworkBtwStatus];

export interface CoworkBtwEntry {
  runId: string;
  sessionId: string;
  question: string;
  selectedTextSnippets?: CoworkSelectedTextSnippet[];
  status: CoworkBtwStatus;
  answer?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface CoworkBtwThread {
  sessionId: string;
  isOpen: boolean;
  draft: string;
  selectedTextSnippets: CoworkSelectedTextSnippet[];
  entries: CoworkBtwEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface CoworkBtwSubmitResponse {
  success: boolean;
  runId: string;
  error?: string;
}
```

Add named IPC channels to `CoworkIpcChannel`:

- `SubmitBtw`
- `StreamBtwResult`

### Renderer

Primary integration points:

- `CoworkPromptInput` detects BTW commands before steer/follow-up routing and
  opens the floating window for the submitted exchange.
- `CoworkService.submitBtw` inserts the pending entry, invokes preload, and
  handles immediate validation or transport failures.
- `coworkSlice` stores one bounded ephemeral `CoworkBtwThread` per session,
  including its draft, selected-text tag, and exchanges.
- `CoworkSessionDetail` opens the window from selected assistant text and
  builds a bounded, prompt-injection-safe question from the excerpt, optional
  draft, and recent answered exchanges.
- `CoworkBtwFloatingPanel` owns viewport-safe drag/resize behavior and renders
  the temporary message list and editable input through a body portal.
- `CoworkService` consumes `StreamBtwResult` and updates only the matching
  run inside the matching session thread while preserving the display question.

BTW thread state must not be added to `CoworkSession.messages` or included in session
hydration. A late result for a deleted session is ignored. A result for a
background session updates that session's in-memory BTW thread without changing
the selected session or triggering normal unread-message behavior.

### Preload and Main Process

Preload exposes:

```ts
submitBtw(options: {
  sessionId: string;
  question: string;
  runId: string;
}): Promise<CoworkBtwSubmitResponse>;

onStreamBtwResult(
  callback: (data: { sessionId: string; result: CoworkBtwEntry }) => void,
): () => void;
```

The main-process `SubmitBtw` handler:

- validates session id, question, and run id;
- ensures OpenClaw is running;
- delegates to `CoworkEngineRouter.submitBtw`;
- returns a structured error without creating a Cowork message;
- logs metadata only, never the question or answer text.

The runtime `btwResult` event is forwarded through `StreamBtwResult` to all
live renderer windows using the same guarded window-send pattern as goal and
context-usage events.

### Runtime Adapter

Add `submitBtw(sessionId, question, runId)` to `CoworkRuntime` and
`CoworkEngineRouter`.

`OpenClawRuntimeAdapter.submitBtw`:

1. resolves the local session and its OpenClaw session key;
2. rejects sessions without existing OpenClaw context;
3. registers the run in a dedicated `pendingBtwRuns` map before sending;
4. calls Gateway `chat.send` directly with `/btw ${question}`;
5. does not call `runTurn`, `continueSession`, or `buildOutboundPrompt`;
6. does not mutate `activeTurns`, `pendingTurns`, local messages, continuity
   capsules, or session status;
7. removes or fails the pending entry if the Gateway request is rejected.

`handleGatewayEvent` adds a `chat.side_result` branch before normal chat
handling. It validates the payload, resolves `sessionKey` and optional
`agentId` to the correct local session, marks the run terminal, and emits
`btwResult`. The client-generated `runId`, session key, and agent identity are
the routing keys. OpenClaw may normalize the echoed `question`, especially for
follow-ups that carry compacted context, so a question-text mismatch is logged
with character counts but does not discard an otherwise correctly routed
result.

The adapter keeps a bounded, expiring set of terminal BTW run ids. Normal
`chat` events whose `runId` belongs to a pending or recently terminal BTW run
are handled by the BTW lifecycle and are not passed to `handleChatEvent`. This
prevents the empty BTW final from completing an unrelated active main turn and
also makes duplicate terminal events harmless.

On Gateway disconnect, runtime restart, session deletion, or BTW timeout,
pending runs are removed and surfaced as failed ephemeral results. Cleanup must
not call normal turn rejection or session error paths.

An explicit side-question stop uses an independent `AbortBtw` IPC and
`CoworkRuntime.abortBtw` method. The adapter marks the pending BTW run as
stop-requested before issuing exact-run `chat.abort`, so an abort event racing
the RPC response settles as `stopped`. Completed or late events remain
suppressed by the bounded terminal BTW run-id set and cannot finalize the main
turn.

## System Invariants

### INV-1: No History Pollution

Neither the command, question, answer, nor BTW error may be inserted into
Cowork messages, SQLite conversation history, continuity capsules, session
titles, or OpenClaw transcript history.

### INV-2: Main-Run Isolation

A BTW request and its terminal events may not create, bind, resolve, reject, or
clean up the session's main active turn.

### INV-3: Session and Agent Isolation

A side result is shown only in the Cowork session matching its OpenClaw
`sessionKey` and, for global keys, its selected `agentId`. Unknown or ambiguous
events are logged and dropped.

### INV-4: Ephemeral State

BTW UI state exists only in renderer/runtime memory. It is cleared on reload,
restart, session delete, and bounded lifecycle cleanup. Hiding the floating
window does not delete the current renderer-lifetime thread. Thread-limit
cleanup is reevaluated when a pending request settles, while pending threads
and the newly settled thread remain protected.

### INV-5: Security Policy Is Runtime-Owned

BTW does not elevate permissions or bypass sandbox/approval policy. Provider,
Codex harness, tool, and reasoning behavior remains controlled by OpenClaw.
LobsterAI never executes model-generated control markup. The current floating
window renders only normalized final side-result text; existing OpenClaw
sandbox and approval flows remain authoritative even when Codex native BTW
uses tools internally.

### INV-6: No Provider Protocol Leakage

Recognized provider control blocks must not be exposed as BTW answers. The
trusted runtime or main-process boundary removes residual DSML, MiniMax, Grok,
legacy bracket, generic tool-call XML, and function-call markup before the
answer reaches renderer state. Ordinary prose and literal protocol examples
inside inline or fenced code remain intact. A tool-only response becomes a
localized, stable tool-required failure and never becomes an executable
renderer action.

## Compatibility

- No SQLite migration is required.
- The version-scoped OpenClaw `v2026.6.1` patch keeps BTW utility fallbacks
  outside Agent run-safety streams while leaving the default Agent path
  unchanged.
- The OpenClaw fallback prompt and final-text sanitizer fix applies across
  non-Codex providers; it is not coupled to DeepSeek model names. DeepSeek DSML
  is one provider-specific marker family covered by the shared boundary.
- A LobsterAI main-process residual guard protects installations using an
  older or incompatible OpenClaw runtime. It changes only BTW display output
  and must not parse or alter normal main-Agent tool events.
- macOS and Windows use the same Electron IPC and Gateway event path.
- Older or incompatible runtimes return a visible ephemeral failure instead of
  silently falling back to a normal chat message.
- Existing normal, Plan, Goal, Steer, queued-follow-up, IM, and scheduled-task
  paths remain unchanged.

## Diagnostics

- Renderer and service logs use the `[CoworkBtw]` tag.
- Main-process IPC logs include session id, run id, status, and character
  counts.
- Runtime logs include the resolved session key, active-main-turn presence,
  side-result routing, question-normalization character counts, terminal-final
  suppression, and cleanup reason.
- Protocol-sanitization diagnostics include only the marker family, run and
  session identity, whether visible prose remained, and before/after character
  counts.
- Logs must not include raw BTW question or answer content.
- Unexpected `chat.side_result` payloads and session-mapping failures use
  `console.warn`; request or runtime failures use `console.error`.

## Verification

- Parser tests cover `/btw`, `/side`, case-insensitive aliases, empty questions,
  multiline rejection, and false positives.
- Redux tests cover editable drafts and selected-text tags,
  pending/answered/failed exchanges, close/reopen behavior, stale async clear
  protection, session isolation, deletion, and memory bounds.
- Runtime tests verify:
  - idle-session BTW delivery;
  - BTW delivery while a main turn remains active;
  - `chat.side_result` session/agent mapping;
  - acceptance of a runtime-normalized echoed question for a matching run;
  - empty BTW `chat` final suppression;
  - duplicate and out-of-order terminal events;
  - Gateway rejection, disconnect, timeout, and session deletion cleanup;
  - absence of Cowork message and transcript mutations.
- Sanitizer and compatibility tests verify:
  - complete, split, and truncated DeepSeek DSML blocks using ASCII and
    full-width bar variants;
  - MiniMax XML, Grok-style tool lines, legacy bracket blocks, generic
    tool-call XML, and function-call markup;
  - mixed prose preserves the visible answer while removing control markup;
  - a tool-only BTW response becomes the localized tool-required failure;
  - literal protocol syntax in inline or fenced code remains visible;
  - no raw prompts, file paths, tool arguments, or answers are logged;
  - normal main-Agent structured tool start/update/result behavior is
    unchanged.
- The Electron compile verifies the shared IPC/preload request, response, and
  listener type contract.
- UI tests verify the two-action selected-text toolbar, bottom-right default
  fallback, prompt-anchored default geometry, viewport clamping, thread state,
  and pending/result/error rendering outside the normal chat message model.
- Changed TypeScript/TSX files pass targeted ESLint.
- Main/preload changes pass `npm run compile:electron`.
- Renderer changes pass `npm run build`.
- Manual Electron verification checklist:
  - BTW returns while a long main task continues;
  - main streaming/tool state is not interrupted;
  - `/side` behaves identically to `/btw`;
  - a non-Codex BTW request that needs a fresh tool operation returns safe
    guidance rather than provider protocol text;
  - a Codex native BTW tool request follows the inherited sandbox and approval
    policy, and stopping it does not stop the main task;
  - the current floating window shows only the Codex BTW final answer and does
    not falsely imply that live tool progress or approval cards are supported;
  - explicitly mutating the same workspace from a Codex BTW request and the
    main task is treated as an unsupported concurrency case until a product
    isolation policy is implemented;
  - switching sessions does not leak a window or thread;
  - the window opens above and right-aligned with the main prompt, falls back
    to the bottom-right when no anchor exists, remains draggable/resizable, and
    is recovered into view after shrinking the application;
  - reload removes the temporary thread;
  - selecting assistant text shows both actions and the side-chat action does
    not send until the side-chat excerpt tag or editable input is submitted;
  - the excerpt tag can be expanded, located, removed, sent without additional
    text, and combined with an independently typed question;
  - a follow-up can refer to a prior side-chat answer without adding either
    exchange to the main history;
  - question copy/re-edit and answer copy actions match the main conversation;
    re-edit only replaces the current side draft and does not send;
  - neither question nor answer appears in history after reload.
