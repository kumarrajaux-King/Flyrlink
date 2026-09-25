# STEP 09 — Messaging, Attachments and Notifications (Phase 9)

Status: **backend complete — awaiting review.** No UI (blocked by `M-06` / `M-07`).

| | |
| --- | --- |
| Delivered | Conversations, messages, attachments, notifications, and the lifecycle→notification bridge |
| Code | `domain/messaging/`, `domain/notification/`, `domain/attachment/`, `services/messaging/`, `services/notification/`, `lib/storage/`, 13 API route files |
| Tests | 121 added (2,131 total) |
| Schema change | **None.** STEP 3 already modelled all six tables |
| RBAC change | **None.** Still 71 permissions |

---

## 1. Summary

Phase 9 makes the platform able to hold a conversation and to tell people things.

Two parties to an engagement get a thread per project, per contract and per team,
plus one-to-one threads with people they already work with. They can attach files.
They are notified when something happens to their engagement — and, critically,
notified through a routing layer that respects what they asked to be told about,
except for a short list of things they do not get to arrange never to have heard.

The phase also closes a gap the earlier phases left open: until now, a milestone
could move to `SUBMITTED` and nobody was informed. The lifecycle engine now
records notifications inside the same transaction as the status write.

**One change to existing code.** The Phase 6 engine gained a five-line call after
its status write. The four lifecycle services were not touched; which event
notifies whom is a pure table.

---

## 2. Scope

| In | Out (and where it goes) |
| --- | --- |
| Conversations: project, contract, team, direct | Group chats not tied to an engagement — no product need |
| Messages: post, read, edit, withdraw, unread counts | Typing indicators, presence, read receipts per person — need a realtime transport (§11) |
| Attachments: reserve → upload → confirm → attach → download | Malware scanning (`M-10`), real object storage (`M-09`) |
| Notifications: record, route, list, read, preferences | Email/SMS/WhatsApp providers — Phase 12, behind the adapters already written |
| The lifecycle→notification bridge | Digests and batching — no product decision yet |
| Every API route the above needs | All UI (`M-06`, `M-07`) |

---

## 3. Architecture

```
  domain/                          pure, exhaustively unit-tested
    messaging/conversation-access   who may read, who may post
    messaging/message-rules         edit window, tombstones, rate limit
    notification/routing            type + preference → channels
    notification/lifecycle-map      which transition tells whom, and what it says
    attachment/rules                type allow-list, size, name and key derivation

  services/
    messaging/conversation-service  open, list, membership, mute, archive, leave
    messaging/message-service       post, read, edit, withdraw, unread
    messaging/attachment-service    reserve, confirm, link, download, authorise
    messaging/participants          who belongs in a thread, derived from the engagement
    notification/notification-service  record, list, read, preferences, dispatch
    notification/channels           IN_APP + three external adapters
    lifecycle/notifications         the bridge the Phase 6 engine calls

  lib/storage/provider              object storage behind an adapter
  lib/http/messaging                session → service → response, and the status map
  lib/validation/messaging          Zod schemas, strictObject throughout
  app/api/**                        12 routes, each a description of one endpoint
```

The layering is the one STEP 02 §5 sets out: routes decide nothing, services own
behaviour, and every rule worth arguing about is a pure function with a test.

---

## 4. The access model

Reading and posting are **different authorities**, and this is the phase's central
decision.

| Actor | Read a thread | Post into it |
| --- | --- | --- |
| Active member | ✅ `message:read:own` | ✅ `message:create:own` |
| Member who left | ❌ `MEMBERSHIP_ENDED` | ❌ |
| Non-member | ❌ `NOT_A_MEMBER` | ❌ |
| ADMIN / SUPPORT / SUPER_ADMIN | ✅ `message:read:any` — **audited** | ❌ |
| SUPPORT, in a `SUPPORT` thread | ✅ | ✅ `ticket:respond:any` |

`message:read:any` is oversight. It exists so a dispute can be investigated, and
it grants reading only: a message in a project thread is attributable to a party
to that engagement, and platform staff are not one. The single exception is a
support thread, where answering is the point, and the grant that allows it says
so by name.

Every oversight read writes `messaging.conversation.oversight_read` at NOTICE
severity, naming the reader. Reading two parties' private correspondence is a
privileged act and leaves a trace. A party reading their own thread writes nothing.

**Authorization is decided before conversation state.** A stranger who asks to
post into an archived thread is told they are not a member — not that the thread
is archived. Otherwise the refusal itself would confirm the thread exists.

---

## 5. Conversations

- **One thread per subject.** Opening is idempotent: the parent row is locked,
  so two people hitting the messages tab at the same moment get one thread, not
  two. There is no unique index to lean on, because `projectId` is nullable — a
  direct thread has no parent.
- **Membership is materialised**, not re-derived on every read. `participants.ts`
  derives who belongs from the engagement (customer, plus experts with a live
  assignment, contract or team seat) when the thread is opened and when
  `syncEngagementMembers` is called.
- **Membership changes are additive.** Nothing removes a member as a side effect
  of a status change. An expert should not silently lose a thread, and its
  history, because a status moved while a dispute about that very engagement is
  open. Leaving is explicit, is the member's own act, and is audited.
- **Archiving is for the thread, not the reader.** It closes the thread to new
  messages for everyone; any member can do it and any member can undo it. Muting
  is the per-person control.
- **Direct threads are not open DMs.** One may only be opened between two people
  who already share a project. A marketplace where any user can message any
  other has a spam problem and a disintermediation problem; the shared-engagement
  check is both controls at once. A user who does not exist and a user you share
  nothing with produce the *same* refusal, so account existence cannot be probed.

Inbox ordering is by `lastMessageAt DESC NULLS LAST, id DESC` with a keyset
cursor — an inbox is about what is happening now, not when a thread was opened.

---

## 6. Messages

| Rule | Value | Why |
| --- | --- | --- |
| Maximum length | 10,000 characters | Long enough for a considered reply |
| Edit window | 15 minutes, author only | Covers the typo; beyond it the thread is a record |
| Edit visibility | `editedAt` always stamped | An edited message is always visibly edited |
| Deletion | Soft, author only, no time limit | Withdrawal stays possible, and stays visible |
| Deleted body | `[message deleted]` tombstone | A message that silently vanishes lets one party rewrite the history the other remembers |
| SYSTEM / AI_AGENT messages | Immutable | They are the machine's account of what happened |
| Rate limit | 30 per minute per author per thread | A guard against a runaway client, not a security control |

The prior text of an edited message is written to the audit log, so an edit
cannot erase what was said. Withdrawing a message withdraws its attachments with
it.

**Platform staff cannot delete a message at all.** Phase 8 established that no
admin code path deletes records, and moderation of private correspondence is not
among the 30 admin capabilities.

### Posting is one transaction

The message, the thread's `lastMessageAt`, the attachment links and the
recipients' notifications commit together or not at all. A message that exists
but notified nobody is a message the other party never learns about — in an
engagement where a milestone is waiting on an answer, that is a commercial
failure, not a cosmetic one.

### The notification carries no preview

`MESSAGE_RECEIVED` says only that there is a new message. A notification can
travel to a lock screen or an inbox; the contents of a private thread should not
follow it there. A test asserts the body never appears in the notification.

### Untrusted by construction

A message body is text a user wrote. It is stored as text, returned as text, and
never interpreted — nothing in the messaging layer renders HTML or evaluates
anything. It is never concatenated into an AI prompt by these services; when an
agent is given conversation content it arrives through the Phase 7 tool layer as
data, inside the prompt-injection boundary of STEP 02 §22.

---

## 7. Attachments

A three-step upload:

1. **Reserve** — the client describes the file; the server validates the
   description, derives a key from values the client does not control, and
   writes a *pending* row.
2. **Upload** — the client sends bytes straight to storage with a short-lived
   ticket. They never pass through a request handler.
3. **Confirm** — the server asks storage what actually landed and compares it
   with what was promised.

Collapsing this into one step means either streaming 25 MB through the
application, or trusting the client's word that the file exists and is what it
said. Step 3 makes a lie detectable: a missing object, or a size that differs
from the declared size, is refused — and on a mismatch the bytes are removed and
the row retired, so a retry starts clean.

**An unconfirmed attachment can never reach a thread.** `linkAttachments`
requires the caller's own, unlinked, confirmed rows, and refuses the whole
message otherwise.

| Control | Rule |
| --- | --- |
| Type | Allow-list of 20 media types; nothing executable has an entry |
| Extension | Must agree with the declared type (`invoice.pdf` as `image/png` is refused) |
| Size | 25 MB, checked at reservation and again on the bytes |
| Name | Sanitised for display only — directories, control characters and leading dots removed |
| Key | Derived: `messages/{conversationId}/{uploaderId}/{uuid}.{ext}`. The client's name contributes nothing, so no client can choose where its bytes land or overwrite another object |
| Serving | `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, always |

SVG is on the allow-list and a browser will execute one as a document if invited
to. Those two headers are what make sure it is never invited to.

Access follows the thread: anyone who may read the conversation may download a
file sent in it; a pending file is visible to its uploader alone.

### Storage

`lib/storage/provider.ts` is the adapter, matching the AI-provider and
email-sender precedents. The development implementation is real — it stores
bytes, reports their true size and computes a real checksum — and is refused in
production. **No S3/R2 adapter exists**: no bucket has been provisioned and
`STORAGE_*` is unset (`M-09`). A configured-but-unimplemented provider throws
rather than silently falling back to a container's disk.

`/api/attachments/content` completes the flow for the development adapter only,
applying by hand the authorisation a signed URL would have carried. With real
storage it is never reached.

---

## 8. Notifications

**One row per channel.** A single row with a "sent" flag cannot answer "was the
email delivered but the SMS refused?", which is exactly the question an operator
asks when a customer says they were never told.

**Recorded inside the caller's transaction; delivered outside it.** A provider
call inside a lifecycle transaction would hold a row lock across a network
round-trip, and a provider timeout would roll back a milestone approval that had
already happened. So the write records the intent, and `dispatchPending` sends
afterwards — the same database-as-queue pattern as `AiRun.status = QUEUED` (T-05).

### Routing

```
actedThemselves          → nothing. Nobody is notified about their own action.
MESSAGE_RECEIVED + muted → nothing.
otherwise                → IN_APP if preferred or mandatory, then EMAIL, SMS, WHATSAPP as preferred
```

Defaults are in-app and email on, SMS and WhatsApp off — identical to the column
defaults in STEP 3, so an absent preference row and a default row behave the same
and there is no hidden third state.

**Ten types keep their in-app record whatever the user sets**: the payment,
escrow, payout, dispute, verification, submission, revision and AI-approval
notifications. The user can silence the email and the SMS, but the platform will
not let them arrange never to have been told that their escrow was released. The
list is deliberately short, and every entry is something the platform may later
have to show it said.

An opt-out for one of those types is still **stored** rather than refused or
ignored: it takes effect on every channel where it can, and the user's stated
wish is never silently rewritten.

### Privacy

A user reads their own notifications and nobody else's. No permission grants
otherwise and no admin route reaches this service. An administrator
investigating a case reads the audit log and the underlying records, not a
person's inbox.

---

## 9. The lifecycle bridge

`domain/notification/lifecycle-map.ts` is one table: entity type + event →
notification type, audience and copy. An event that is absent notifies nobody,
which is the default and needs no entry. 36 events across the four machines have
entries (14 project, 8 contract, 7 milestone, 7 payment).

The alternative — each lifecycle service emitting its own — spreads "who hears
about what" across four files and makes the honest question ("does the expert
learn when the customer funds a milestone?") answerable only by reading all of
them. Here it is one grep, and the four services were not modified.

The table names **sides**, not user ids. The engine resolves a side to that
record's participants, using the same `spec.participants` the authorization step
uses, and the routing rules then drop whoever caused the event.

A test asserts every mapped event exists on its state machine — a renamed event
would otherwise notify nobody and fail silently forever — and that every mapped
type exists in the schema enum.

### Copy

Flat and factual: no urgency, no marketing tone, no promise of a date, price or
amount. A test rejects "guarantee", "urgent", "act now" and "immediately". Where
a figure or a name belongs in the text, drafting it is the Communication Agent's
job (Phase 7); this table is the fallback that always works, including when no
AI is available.

### The stored link

A notification stores one `actionUrl`, but a customer and an expert reach the
same contract by different paths (STEP 01 §6.2 and §6.3). The canonical
project-scoped route is stored and the frontend sends each role to its own
surface, rather than guessing the recipient's role and baking it into a stored
string (**A-15**).

---

## 10. AI boundary

| Decision | Reasoning |
| --- | --- |
| `sendNotification` now routes through the notification service | An agent's notification is subject to exactly the same preferences as one the platform raises itself. An agent cannot reach a channel the recipient switched off |
| **No tool posts a message into a conversation** | `postAgentMessage` exists as a server-side function with no tool wrapping it. Agents draft notification copy; they do not join conversations. Adding that tool is a product decision, not an implementation detail |
| An `AI_AGENT` message requires an `aiRunId` | Not optional. An AI message with no traceable run is one nobody can audit, and blueprint rule 16 — an agent never passes as a person — depends on the label and the trail both existing |

No forbidden capability is approached: nothing here moves money, changes a
contract, or deletes a record. The registry still contains 15 tools and the
standing forbidden-pattern test still passes.

---

## 11. Realtime

There is none, and that is deliberate for this phase. The API is poll-shaped:
`/api/notifications/summary` gives the two badge counts in one request, and the
message list is cursor-paginated.

A live transport (Server-Sent Events or WebSockets) is a deployment decision as
much as a code one — it needs a connection-capable host and a fan-out
mechanism, neither of which is settled before Phase 14. The data model does not
change when it arrives: a transport pushes what these services already write.

---

## 12. API routes (13 files, 22 operations)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/conversations` | Inbox, most recently active first |
| POST | `/api/conversations` | Open or reuse a thread (project / contract / team / direct) |
| GET | `/api/conversations/:id` | One conversation |
| PATCH | `/api/conversations/:id` | Mute for yourself; archive for everyone |
| DELETE | `/api/conversations/:id` | Leave. The thread is not deleted |
| GET | `/api/conversations/:id/messages` | A page of the thread |
| POST | `/api/conversations/:id/messages` | Post as the session's human |
| POST | `/api/conversations/:id/read` | Mark read up to now |
| PATCH | `/api/messages/:id` | Correct your own, inside the window |
| DELETE | `/api/messages/:id` | Withdraw your own |
| POST | `/api/attachments` | Reserve an upload |
| GET/POST/DELETE | `/api/attachments/:id` | Download link / confirm / withdraw |
| PUT/GET | `/api/attachments/content` | Bytes — development adapter only |
| GET | `/api/notifications` | Your own in-app notifications |
| POST | `/api/notifications/:id/read` | Mark one read |
| POST | `/api/notifications/read-all` | Clear the badge |
| GET/PUT | `/api/notifications/preferences` | Read and set per-type channels |
| GET | `/api/notifications/summary` | Both badge counts in one call |

### Error codes

`CONVERSATION_ARCHIVED` (409) · `CONVERSATION_NOT_A_MEMBER` (403) ·
`NO_SHARED_ENGAGEMENT` (403) · `RATE_LIMITED` (429) · `MESSAGE_IMMUTABLE` (409) ·
`ATTACHMENT_REJECTED` (422) · `UPLOAD_INCOMPLETE` (409), alongside the existing
`FORBIDDEN_RESOURCE`, `NOT_FOUND`, `VALIDATION_FAILED`, `MALFORMED_JSON` and
`UNAUTHENTICATED`.

`strictObject` throughout means a client cannot smuggle in a sender, a message
type, a checksum or a storage key — a route test asserts that trying is a 422,
not silent input.

---

## 13. Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `npm run lint` | Clean |
| `npm test` | **2,131 passed** (121 added; 2,010 pre-existing still pass) |
| `npm run build` | Clean; 13 new routes registered |

**Run against real PostgreSQL 16.13** — the first phase to do so. The
intermittent `ai-orchestrator.test.ts` connection failures reported in
`STEP-08-ADMIN-OPERATIONS.md` §15 **did not recur**, which confirms the Phase 8
diagnosis: it was the Docker-less PGlite bridge, not application code.

New tests: 53 unit (access, mutation rules, attachment rules, routing, the
lifecycle map) and 68 integration (42 service, 26 route).

---

## 14. Assumptions recorded

| ID | Assumption |
| --- | --- |
| A-13 | A member who leaves a conversation loses access to it, including its history. The record stays available to the remaining parties and to oversight |
| A-14 | A direct thread may only be opened between two people who already share a project. There is no "message this expert" path that bypasses an engagement |
| A-15 | A notification stores the canonical project-scoped link; role-appropriate routing is the frontend's job |
| A-16 | A contract thread is typed `PROJECT` with `contractId` set — `ConversationType` has no `CONTRACT` member, and adding one is a migration nothing here needs |

---

## 15. Blocking inputs added

| # | Missing | Blocks |
| --- | --- | --- |
| M-09 | **Object storage** — bucket, endpoint and credentials (S3/R2/GCS) | Real attachment storage. The adapter interface is written; only the remote implementation is missing |
| M-10 | **Malware scanning service** | Scanning uploads between steps 2 and 3. Type, extension and size validation are in place; content is not inspected |

---

## 16. Open decisions for review

| ID | Decision | Position taken |
| --- | --- | --- |
| C-01 | Should oversight roles be able to post into a project thread? | **No** — read-only, audited. Only `SUPPORT` in a `SUPPORT` thread may write |
| C-02 | Should a member who leaves keep read access to history? | **No** (A-13). The alternative — read-only history for former members — is defensible and reversible |
| C-03 | Should direct threads require a shared engagement? | **Yes** (A-14) |
| C-04 | Which notification types may a user not switch off in-app? | The ten in §8. Adding or removing one is a product call |
| C-05 | Should an agent be able to post into a conversation? | **Not implemented.** The service exists; no tool exposes it |
| C-06 | Is a 15-minute edit window and a 30-per-minute rate limit right? | Both are single constants with tests pinning them |
