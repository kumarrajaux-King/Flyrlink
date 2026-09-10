# AI Agent Architecture — Phase 7

| Field | Value |
| --- | --- |
| Status | **Implemented — awaiting review** |
| Phase | 7 |
| Depends on | STEP 01–04 (all signed off) |
| Schema impact | **One enum value** (`AiAgentKey += REQUIREMENTS_ANALYST`) + migration |
| Artifacts | `ai/`, `services/ai/`, `app/api/ai/`, 1 migration |

---

## 1. The safety guarantee, and why it holds

The mandate lists actions AI must never perform autonomously. They are **not** implemented as high-risk tools behind an approval gate. They are implemented as **capabilities that have no tool at all**.

| Forbidden capability | How it is prevented |
| --- | --- |
| Move money · release escrow | No tool exists. The payment agent's entire toolset is read-only. |
| Approve payouts · issue refunds | No tool exists. |
| Change commissions | No tool exists. |
| Modify/sign/terminate contracts | Only `createContractDraft` exists — it writes an **unsigned** `ContractVersion` and is itself HIGH risk. |
| Permanently delete records | No tool exists. |
| Bypass RBAC | No role-granting tool exists; permissions are checked against the **human**. |
| Bypass verification | The verification agent has exactly one tool: `getExpertProfile`. It reports findings; a human decides. |

This matters because it does not depend on the policy engine being reached, a risk tier being set correctly, a prompt being obeyed, or a reviewer paying attention. **An agent cannot call a handler that does not exist.**

Four independent layers back it up:

1. **Registration** — `registerTool` throws `ForbiddenCapabilityError` on any name implying a forbidden capability, so the rule is enforced when code is written, not when it runs.
2. **Policy engine** — re-checks the capability *before* risk tier, so even a mis-tiered dangerous tool is refused.
3. **Database CHECK constraints** (STEP 3) — a HIGH/CRITICAL action cannot be stored as `AUTO_APPROVED`, nor as `EXECUTED` without a named approver.
4. **Tests** — a standing assertion that no registered tool matches a forbidden pattern, plus one that no tool writes to a financial table.

## 2. Architecture

```
app/api/ai/**            transport — validate, delegate, shape
       │
services/ai/             approval + observability (RBAC-gated)
       │
ai/runtime/orchestrator  the controlled path
       ├── ai/agents/    13 definitions: model, prompt, I/O schema, tool allow-list
       ├── ai/policy/    forbidden capabilities · risk tiers · policy engine
       ├── ai/tools/     controlled registry — the ONLY database access
       ├── ai/redaction/ PII masking at egress and at persistence
       └── ai/providers/ Anthropic · OpenAI · Fake
```

The orchestrator's path, in order:

```
resolve agent + version → redact input → persist AiRun (RUNNING)
  → provider call (retry on transient)
  → per tool call: policy.evaluate → persist AiAction → execute OR hold
  → validate output against Zod
  → persist output, tokens, cost, latency → audit
```

## 3. Agent registry (13)

| # | Agent | Key | Risk | Tools |
| --- | --- | --- | --- | --- |
| 1 | Project Architect | `PROJECT_ARCHITECT` | MEDIUM | context, saveRequirements |
| 2 | Requirements Analyst | `REQUIREMENTS_ANALYST` | MEDIUM | context, saveRequirements |
| 3 | Estimation | `ESTIMATION` | MEDIUM | context, saveEstimate |
| 4 | Talent Discovery | `TALENT_DISCOVERY` | LOW | context, search, profile, availability |
| 5 | Matching | `MATCHING` | MEDIUM | context, profile, performance, availability, createRecommendation, **createAssignmentDraft (HIGH)** |
| 6 | Team Builder | `TEAM_BUILDER` | MEDIUM | context, search, profile |
| 7 | Verification Assistant | `VERIFICATION` | MEDIUM | **getExpertProfile only** |
| 8 | Contract Drafting | `CONTRACT` | HIGH | context, **createContractDraft (HIGH)**, createMilestoneDraft |
| 9 | Project Execution | `EXECUTION` | LOW | context, milestoneStatus |
| 10 | Risk Monitoring | `RISK` | MEDIUM | context, milestoneStatus, paymentStatus, sendNotification |
| 11 | Communication | `COMMUNICATION` | MEDIUM | context, sendNotification |
| 12 | Payment Monitoring | `PAYMENT` | LOW | **read-only only** |
| 13 | Support / Resolution | `SUPPORT_RESOLUTION` | LOW | context, milestoneStatus, paymentStatus |

`allowedTools` is an **allow-list, not a hint** — the policy engine denies anything outside it, so an agent cannot widen its own reach by asking.

**Versioning.** Each definition pins a version, model, provider and prompt reference. `AiAgentVersion` stores a hash of the system prompt, and editing a prompt without bumping the version **throws** — otherwise historical runs would silently point at a prompt that never produced them.

## 4. Tool registry (14)

| Tool | Risk | Permission | Effect |
| --- | --- | --- | --- |
| `searchExperts` | LOW | `expert:read:any` | read |
| `getExpertProfile` | LOW | `expert:read:any` | read |
| `getExpertAvailability` | LOW | `expert:read:any` | read |
| `getExpertPerformance` | LOW | `expert:read:any` | read |
| `getProjectContext` | LOW | `project:read:any` | read |
| `getMilestoneStatus` | LOW | `milestone:read:any` | read |
| `getPaymentStatus` | LOW | `payment:read:any` | read |
| `saveProjectRequirements` | MEDIUM | `project:update:any` | unapproved rows, `source = AI_AGENT` |
| `saveProjectEstimate` | MEDIUM | `project:update:any` | advisory estimate fields |
| `createRecommendation` | MEDIUM | `project:update:any` | `PROPOSED` |
| `createMilestoneDraft` | MEDIUM | `project:update:any` | `DRAFT`, unfunded |
| `sendNotification` | MEDIUM | `project:read:any` | in-app only |
| `createAssignmentDraft` | **HIGH** | `project:assign:any` | `DRAFT`, `isAiInitiated` |
| `createContractDraft` | **HIGH** | `project:update:any` | unsigned version |

Every tool declares name, description, Zod input **and** output schema, risk tier, required permission, idempotency and audit action. A tool missing any of these cannot be registered. Output is validated too — a handler returning an unexpected shape is our bug and must not be fed back into the model.

**Every write tool produces a draft.** Nothing transitions a state machine, moves money or binds a party.

**Deliberately not implemented:** `createPaymentIntent` (payment initiation is a customer action, not an agent one), `createRefundRequest` (the mandate forbids issuing refunds; the support agent escalates instead), and `createSupportTicket` (no `SupportTicket` model exists, and Phase 7 adds no unrelated schema).

## 5. Policy and risk model

```
agent → policy engine → agent enabled? → tool exists? → forbidden capability?
      → allow-listed for this agent? → actor present? → actor permitted?
      → risk tier → ALLOW | REQUIRE_APPROVAL | DENY
```

| Tier | Meaning | Outcome |
| --- | --- | --- |
| LOW | read-only | execute inline |
| MEDIUM | non-binding draft | execute inline |
| HIGH | commercial/contractual effect | **hold for human approval** |
| CRITICAL | financial/account effect | **hold + SUPER_ADMIN** |

Two properties are deliberate:

- **It fails closed.** Unknown tool, un-allow-listed tool, missing actor, disabled agent — all DENY. There is no default-allow branch.
- **Permissions are the human's, never the agent's.** An agent can never exceed the authority of the person it acts for. This is also what makes prompt injection ineffective: text an agent reads cannot grant permissions its user does not hold.

Tool permissions are `:any`-scoped by construction (registration rejects `:own`, which would always deny without a resource); per-resource ownership is enforced inside each handler, where the resource is actually loaded.

## 6. Human-in-the-loop

A HIGH/CRITICAL call is recorded as `PENDING_APPROVAL` and the run ends. It can only ever execute through `services/ai/approval-service`, which requires:

1. `ai:approve:any` — held only by privileged, **MFA-gated** roles
2. SUPER_ADMIN for CRITICAL
3. A conditional status update, so two approvers racing cannot both execute it

**The approving human becomes the acting identity.** The tool runs with *their* permissions and is audited against *their* name — they are taking responsibility, so they should not inherit the original requester's authority.

Rejection is terminal. `expireStaleApprovals` ages out an unattended queue.

## 7. Persistence

| Model | Use |
| --- | --- |
| `AiAgent` | registry, enable/disable |
| `AiAgentVersion` | version + model + provider + prompt hash — the traceability anchor |
| `AiRun` | one invocation: input, validated output, tokens, **cost in minor units**, latency, errors, retries |
| `AiAction` | every proposed tool call, including denied ones, with the policy decision that gated it |
| `Recommendation` | the explainable match output (11 score dimensions + evidence + `aiRunId`) |
| `AuditLog` | `actorType = AI_AGENT` with `actorAiRunId` |

No new tables. AI spend uses `costMinor` + `currency`, so it reconciles with financial reporting under T-03 instead of living in a separate float.

**Denied calls are persisted too** — the audit trail shows what the agent *wanted* to do, not only what it did.

## 8. Background jobs

No job table was added: `AiRun.status = QUEUED` already is a durable, indexed, auditable queue, so it *is* the queue. `AiRunJobQueue` implements the `AgentJobQueue` interface; swapping in Redis/BullMQ at the scale tier means reimplementing the driver, not touching callers. Claiming uses a conditional update so two workers cannot take the same job.

## 9. Security and privacy

| Control | Implementation |
| --- | --- |
| Context isolation | Agents receive only what their tools return, each scoped to the acting user |
| Memory boundaries | **No cross-run agent memory.** State lives in domain tables; each run starts clean |
| PII redaction | Applied **before egress and before persistence** — emails, phones, card-shaped digits, national IDs, provider keys, and ~30 sensitive key names |
| Prompt injection | Untrusted content travels in the input payload, never the system prompt; tool authorization is against the acting user, never the content |
| Structured output | Zod-validated before anything is written; invalid output is a failed run with **no partial write** |
| Idempotency | `AiAction.idempotencyKey` unique per run, from the provider's tool-call id |
| Secrets | Provider keys from environment only; never logged, never in a payload |
| Observability access | `ai:read:any` — privileged and MFA-gated, so run payloads are unreadable from an un-challenged session |

## 10. Providers

`AiProvider` is one narrow interface: a structured completion. Adapters for **Anthropic** (default, `claude-opus-5`, adaptive thinking, `output_config.format`, `strict: true` tools) and **OpenAI** (`gpt-5`, `response_format: json_schema`). Agents describe intent in vendor-neutral terms; Zod schemas convert once to JSON Schema, which both accept.

**`FakeProvider`** is what makes Phase 7's "deterministic tests without live AI dependency" real. It scripts responses, tool calls and failures, and records every request — which is how the tests verify things otherwise invisible: that redaction happened before egress, that untrusted content never reached the system prompt, and that only allow-listed tools were offered.

Retry: transient failures (429, 5xx, connection) retried twice with exponential backoff; non-retryable failures fail immediately. A refusal is never retried.

## 11. API

```
POST   /api/ai/agents/:agentKey/run   run an agent (202)
GET    /api/ai/agents                 registry + version history
GET    /api/ai/runs                   run log
GET    /api/ai/runs/:runId            full traceability detail
GET    /api/ai/approvals              the human approval queue
POST   /api/ai/approvals/:actionId    approve or reject
GET    /api/ai/health                 success rate, spend, match acceptance, override rate
```

## 12. Verification

| Gate | Result |
| --- | --- |
| Migration applied (4th) | PASS — no drift |
| `tsc --noEmit` | PASS — 0 errors |
| `eslint .` | PASS — 0 problems |
| `vitest run` | PASS — **279 tests** (up from 198) |
| `next build` | PASS — 20 routes + middleware |

**Two real defects surfaced by the tests:**

1. **`createAssignmentDraft` was registered but allow-listed to no agent** — the policy engine correctly denied it, silently. Added to the Matching agent, plus a standing test that no registered tool is unreachable.
2. A Prisma JSON typing boundary, fixed once inside `redactForStorage` rather than cast at every call site.

## 13. Known limitations

| Item | Status |
| --- | --- |
| Live provider calls never exercised | Tests use `FakeProvider` by design. A smoke test against a real key is worth doing before Phase 8. |
| Cost tables are hand-maintained | Vendor price changes need a manual edit. Small and explicit, but not automatic. |
| No `SupportTicket` model | The support agent triages and escalates; ticket persistence needs a model, deferred to avoid unrelated schema change. |
| Multi-turn tool loops capped at 6 | Deliberate runaway guard; may need tuning under real prompts. |
| OpenAI adapter untested against the live API | Written to the documented contract, typechecked, never called. Anthropic is the default. |
| `z.record(...)` schemas | Produce open JSON Schema, which OpenAI strict mode may reject. Fine on Anthropic. |
