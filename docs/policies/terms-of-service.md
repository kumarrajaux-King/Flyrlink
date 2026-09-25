# Flyrlink — Terms of Service

| Field | Value |
| --- | --- |
| Status | **Draft for counsel review. Not in force.** |
| Version | 0.1 (unpublished) |
| Owner | Legal, with Product and Finance |
| Blocked by | `M-04` launch geography and legal entity · `M-05` legal review · `M-03` commission model |
| Related | `docs/policies/escrow-and-disputes.md` |

> [!CAUTION]
> **This is drafting input, not legal advice, and not a published agreement.** It was
> written to be reviewed by qualified counsel in the launch jurisdiction. Several clauses
> below are enforceable only in some jurisdictions and are flagged. `M-05` stays open until
> counsel signs this off. Do not present it to users, and do not treat acceptance of it as
> binding, before that.

**Legend** — `[ENFORCED]` the platform technically enforces this today ·
`[CONTRACTUAL]` binding on the parties but not machine-enforced ·
`[COUNSEL]` a clause whose enforceability must be confirmed.

---

## 1. Definitions

| Term | Meaning |
| --- | --- |
| **Flyrlink**, "we", "us" | The operating entity (to be named on completion of `M-04`) |
| **Platform** | The Flyrlink website, applications and APIs |
| **Client** | A user who posts work, engages an Expert, or funds a milestone |
| **Expert** | A user who offers services, accepts engagements, or delivers work |
| **User** | Any account holder, including administrators |
| **Engagement** | A project, its contract, milestones and deliverables |
| **Escrow** | Client funds held against a milestone, per the Escrow and Dispute Policy |
| **Agent** | An automated component that analyses, estimates, ranks or drafts, subject to human approval |
| **Platform Content** | Content we own or license |
| **User Content** | Anything a User submits, including briefs, proposals, messages and deliverables |

---

## 2. Agreement and eligibility

2.1 By creating an account or using the Platform you accept these Terms. If you accept on
behalf of an organisation, you confirm you are authorised to bind it.

2.2 You must be at least 18 and legally able to enter contracts. `[CONTRACTUAL]`

2.3 You must not be barred from receiving services under applicable sanctions or trade
law, and you must not be on a sanctions list. `[COUNSEL]` — screening is not yet
implemented; see the Escrow and Dispute Policy §8.

2.4 One account per person or organisation. Additional accounts to evade suspension,
fees or verification outcomes are prohibited. `[CONTRACTUAL]`

---

## 3. Account security and identity verification

3.1 You are responsible for your credentials and for activity under your account.

3.2 Passwords are stored only as strong one-way hashes. Session tokens are stored only as
digests. We will never ask for your password. `[ENFORCED]`

3.3 **Multi-factor authentication is mandatory** for administrative, financial and
verification roles, and any privileged action is refused without it. `[ENFORCED]`

3.4 A privilege change — a password reset, an MFA change, a role grant or revocation —
revokes existing sessions. `[ENFORCED]`

3.5 **Identity verification.** Experts may submit identity documents, credentials and
portfolio evidence. A human verification manager decides. Automated systems may flag
inconsistencies but can never grant verified status. `[ENFORCED]`

3.6 Verified status is a statement about evidence reviewed at a point in time. It is not
a warranty of performance, and it may be withdrawn if evidence is contradicted, expires
or is withdrawn. `[ENFORCED]`

3.7 Submitting forged, borrowed or misrepresented evidence is grounds for immediate
suspension and permanent removal. `[CONTRACTUAL]`

---

## 4. What Flyrlink is, and is not

4.1 Flyrlink is a marketplace and a set of contracting, payment and governance tools. The
engagement is between Client and Expert.

4.2 **We are not a party to that engagement.** We are not an employer, agency, joint
employer, staffing firm or professional-services provider, and we do not supervise or
direct how an Expert performs work. Experts are independent contractors.

4.3 We do not guarantee that a Client will find a suitable Expert, that an Expert will
find work, or that work will be satisfactory.

4.4 Estimates, match scores and recommendations produced by our Agents are **advisory**.
They are proposals for a human to weigh, never quotes or guarantees. `[ENFORCED]`

4.5 Where we intervene administratively — suspending an account, resolving a dispute,
terminating a contract — we act to operate the Platform under these Terms. Every such
action requires a stated reason, an explicit confirmation, and is recorded. `[ENFORCED]`

---

## 5. User representations

You represent, each time you use the Platform, that:

5.1 Information you provide, including credentials and portfolio evidence, is true and
your own. `[CONTRACTUAL]`

5.2 You hold the rights to the User Content you submit. `[CONTRACTUAL]`

5.3 You will comply with applicable law, including tax obligations. We do not withhold or
file taxes on your behalf unless we say so in writing for your jurisdiction. `[COUNSEL]`

5.4 You will not misrepresent your identity, skills, availability, or who performed the
work. Subcontracting must be disclosed to the Client. `[CONTRACTUAL]`

---

## 6. Engagements, contracts and milestones

6.1 A contract is formed when the Client sends the terms and the Expert accepts them.
Sending is the Client's signature; acceptance is the Expert's. `[ENFORCED]`

6.2 **Accepted terms are immutable.** A change creates a new version requiring fresh
acceptance; the previous version is retained and never edited. `[ENFORCED]`

6.3 Work is organised into milestones, each with scope, acceptance criteria and an amount.

6.4 An Expert should not begin work on a milestone before it is funded. Work performed
outside a funded milestone is outside escrow protection. `[CONTRACTUAL]`

6.5 The Client reviews a delivery and either approves it or requests a revision. Approval
makes escrow release-eligible. `[ENFORCED]`

6.6 Either party may raise a dispute, which freezes release across the engagement.
`[ENFORCED]`

---

## 7. Fees and payment

7.1 Fees are set out in the Escrow and Dispute Policy and on the pricing page. `[BLOCKED
— `M-03`]`

7.2 Funds are held in escrow and released per that policy. Release is a separate act
requiring an authorised finance role with MFA, refused while a dispute is open.
`[ENFORCED]`

7.3 Payment capture is recognised only from a signature-verified provider webhook. No
redirect, message or administrative action substitutes for it. `[ENFORCED]`

7.4 You are responsible for taxes on your own income. `[COUNSEL]`

7.5 Chargebacks and reversals are handled per the Escrow and Dispute Policy §7.

---

## 8. Non-circumvention

> [!WARNING]
> `[COUNSEL]` Liquidated damages, fixed multipliers and post-engagement restraints are
> unenforceable or capped in several jurisdictions, and restraints on an independent
> contractor's ability to work draw particular scrutiny. Counsel must set the numbers,
> the duration and the remedy, and confirm each is enforceable where we launch. The
> figures below are drafting placeholders for that conversation, not approved terms.

8.1 **The rule.** For **12 months** after your first introduction through the Platform,
you will not arrange or invoice work with that counterparty outside the Platform, where
the relationship began here. `[CONTRACTUAL]`

8.2 **What is prohibited.** Soliciting a move off-platform; sharing contact details to
avoid fees before a contract exists; invoicing a matched counterparty directly for
matched work; and using Platform data to build a competing roster. `[CONTRACTUAL]`

8.3 **What is not prohibited.** Working with someone you already worked with before
Flyrlink, where you can evidence the prior relationship; work in a different field with
no connection to the introduction; and continuing a relationship after a permitted
buy-out under 8.5.

8.4 **Consequences.** Graduated, and never automatic:

| Finding | Consequence |
| --- | --- |
| First, no completed off-platform work | Written warning, recorded |
| Solicitation with evidence | Feature restriction, loss of matching priority |
| Completed off-platform work | Recovery of the fees avoided, plus an administrative charge `[COUNSEL]` |
| Repeated or organised evasion | Termination and permanent removal |

8.5 **Relationship buy-out.** A Client may take a relationship off-platform by paying a
conversion fee, set on the pricing page and confirmed in writing. Once paid, clause 8.1
no longer applies to that counterparty. `[BLOCKED — `M-03`]`

8.6 **Enterprise opt-out.** An enterprise Client may negotiate a written agreement
replacing this section — for example a per-seat or subscription arrangement where
introductions are not fee-bearing. `[CONTRACTUAL]`

8.7 **Process.** We act on evidence, not suspicion. You will be told what we found, and
may respond before any charge or termination. Findings and responses are recorded.
`[CONTRACTUAL]`

---

## 9. Intellectual property in deliverables

9.1 **Before release.** The Expert retains ownership of a deliverable until escrow for
that milestone is released in full. The Client receives a limited, non-transferable
licence to review and evaluate it for approval purposes only. `[CONTRACTUAL]`

9.2 **On release.** On **full release of escrow for the milestone**, the Expert assigns to
the Client all right, title and interest in the deliverables produced for it, including
copyright, with effect from release. `[CONTRACTUAL]`

> [!NOTE]
> `[COUNSEL]` Drafted as a **present assignment on payment**, not as "work made for hire".
> That doctrine is US-specific, applies only to enumerated categories or employees, and
> does not travel; a present assignment with a moral-rights waiver where permitted is the
> portable construction. Counsel should confirm the wording for each launch jurisdiction.

9.3 **Partial payment.** Where a milestone is partially refunded or split by a dispute
decision, ownership passes only to the extent released, and the parties must agree in
writing what the Client may use. `[CONTRACTUAL]`

9.4 **Retained materials.** The assignment does not cover an Expert's pre-existing
materials, tools or general know-how. Where those are embedded, the Expert grants a
perpetual, worldwide, royalty-free licence to use them within the deliverable.
`[CONTRACTUAL]`

9.5 **Third-party and open-source material.** An Expert must disclose third-party
components and their licences before delivery, and must not embed material the Client
cannot lawfully use. `[CONTRACTUAL]`

9.6 **Portfolio rights.** Unless the contract says otherwise, an Expert may describe the
engagement at a high level. Confidential details, client data and unreleased material may
not be shown. `[CONTRACTUAL]`

9.7 **Platform licence.** You grant us a licence to host, transmit and display your User
Content only to operate the Platform. We do not sell it, and we do not use private
deliverables to train models. `[CONTRACTUAL]`

---

## 10. Acceptable use and AI safety

10.1 **Prohibited generally:** unlawful work; infringement; deceptive impersonation;
malware; unauthorised access; harassment; scraping the Platform; circumventing security
or rate limits; and using the Platform to launder funds. `[CONTRACTUAL]`

10.2 **Disclosure of AI assistance.** Where a deliverable is substantially generated by
an AI system, the Expert must tell the Client before delivery. Passing generated work off
as bespoke human work when asked is a misrepresentation under 5.4. `[CONTRACTUAL]`

10.3 **Responsibility is not delegable.** An Expert is responsible for what they deliver,
including anything an AI tool produced: accuracy, licensing, and the absence of
infringing or unsafe content. `[CONTRACTUAL]`

10.4 **Our Agents and your data.** Agents analyse briefs, estimate effort and rank
candidates. They act only through a controlled tool layer, have no direct database
access, and cannot move money, approve work, grant verification, alter contracts, delete
records or bypass permissions. High-risk proposals are queued for a human. `[ENFORCED]`

10.5 **Prompt injection and manipulation.** You must not place instructions in briefs,
messages, documents, profiles or deliverables intended to manipulate our Agents — for
example to inflate a match score, reveal another user's data, or trigger an action a
human did not authorise. Treat it as attempted unauthorised access. `[CONTRACTUAL]`,
with structural mitigation `[ENFORCED]`: agent output is schema-validated before it can
touch data, tools require the acting human's own permissions, and every tool call is
recorded with the policy decision that gated it.

10.6 **No automated adverse decisions.** Suspension, verification refusal, dispute
outcomes and payment decisions are made by people. An Agent may surface a signal; it
never decides. `[ENFORCED]`

10.7 **Reporting.** Security issues and suspected manipulation should be reported to
security@flyrlink (address to be confirmed with `M-04`). We will not pursue good-faith
research that respects user privacy and avoids service disruption. `[CONTRACTUAL]`

---

## 11. Suspension and termination

11.1 You may close your account at any time. Obligations already incurred — funded
milestones, open disputes, fees — survive.

11.2 We may suspend or terminate an account for a breach of these Terms, for suspected
fraud, on sanctions grounds, or where required by law. `[ENFORCED]`

11.3 **Process.** Suspension requires a stated reason and confirmation by an authorised
administrator; sessions end immediately; the action is recorded with who took it and why.
Only a super administrator may act on another privileged account, and nobody may act on
their own. `[ENFORCED]`

11.4 **Effect on money.** Suspension does not forfeit funds. Escrow on a suspended
engagement is resolved through the dispute process. `[CONTRACTUAL]`

11.5 **Appeal.** You may contest a suspension in writing. A different administrator
reviews it. `[PROPOSED]`

---

## 12. Disputes

12.1 Disputes between Client and Expert follow the Escrow and Dispute Policy: collaborative
resolution, then first-line triage, then a binding administrative decision.

12.2 A decision under that policy binds the parties **within the Platform** — it governs
escrow, release and account standing. It does not oust any right you have at law.
`[COUNSEL]`

12.3 Disputes between you and Flyrlink: governing law, forum, and any arbitration or
class-action provision are **to be settled by counsel on completion of `M-04`**. Nothing is
stated here, because an unenforceable or unfair forum clause is worse than none.

---

## 13. Warranties, liability and indemnity

13.1 The Platform is provided "as is" and "as available", to the extent the law allows.
`[COUNSEL]`

13.2 We do not warrant any Expert's work, any Client's conduct, or the accuracy of any
Agent output.

13.3 **Liability cap and exclusions** — amount, carve-outs and consumer protections to be
set by counsel (`M-04`). Consumer law in several jurisdictions overrides caps, so no
figure is drafted here. `[COUNSEL]`

13.4 You indemnify us against claims arising from your User Content, your breach of these
Terms, your engagements, and your tax or employment-classification obligations.
`[COUNSEL]`

---

## 14. Data protection

14.1 Personal data is handled per the Privacy Policy (to be drafted; `M-05`).

14.2 **Already true of the system:** secrets are redacted before anything is written to
the audit trail; audit records are append-only; administrative reads of audit data are
scoped to a role's remit; and card numbers and payment credentials are never stored —
only provider references. `[ENFORCED]`

14.3 Data-subject rights, retention periods, international transfer mechanisms and
processor terms must be completed with counsel before launch. `[BLOCKED — `M-04`, `M-05`]`

---

## 15. Changes and notices

15.1 We may amend these Terms. Material changes take effect no less than **30 days** after
notice, except where a change is required by law or to address a security risk.
`[CONTRACTUAL]`

15.2 Changes do not apply retrospectively to an engagement already contracted; that
engagement keeps the version it was formed under. `[CONTRACTUAL]`

15.3 Notices go to your registered email and are shown in the Platform.

15.4 The entity, registered address, governing law and contact addresses are completed on
`M-04`.

---

## 16. Open items for counsel

| # | Clause | Question |
| --- | --- | --- |
| 1 | 8.1–8.5 | Are a 12-month restraint, fee recovery and a conversion buy-out enforceable in the launch jurisdiction, and against independent contractors? |
| 2 | 9.2 | Confirm present assignment on payment, plus moral-rights treatment, per jurisdiction |
| 3 | 12.3 | Governing law, forum, arbitration and class-action treatment |
| 4 | 13.3–13.4 | Liability cap, consumer-law overrides, indemnity scope |
| 5 | 5.3, 13.4 | Worker-classification and tax-withholding exposure by market |
| 6 | 3.3, §14 | Whether any market requires stricter identity or data localisation |
| 7 | Escrow §3 | Whether deemed acceptance after an inspection period is permitted for consumers |
| 8 | Escrow §7 | Chargeback indemnity enforceability |
