# Flyrlink — Terms of Service

| Field | Value |
| --- | --- |
| Status | **Draft for counsel review. Not in force.** |
| Version | 0.1 (unpublished) |
| Owner | Legal, with Product and Finance |
| Jurisdiction | **India.** Drafted for Indian law, Indian forum and INR settlement |
| Blocked by | `M-04a` legal entity, CIN and registered office · `M-05` review by Indian counsel |
| Related | `docs/policies/escrow-and-disputes.md` |

> [!CAUTION]
> **This is drafting input, not legal advice, and not a published agreement.** It is drafted
> for **India** and must be reviewed by Indian counsel. Two clauses carry real risk of being
> struck down rather than merely narrowed, and are flagged where they appear: the
> post-engagement restraint in §8, against section 27 of the Indian Contract Act 1872, and
> the assignment of deliverables in §9, against the formalities in section 19 of the
> Copyright Act 1957. `M-05` stays open until counsel signs this off. Do not present it to
> users, and do not treat acceptance of it as binding, before that.

**Legend** — `[ENFORCED]` the platform technically enforces this today ·
`[CONTRACTUAL]` binding on the parties but not machine-enforced ·
`[COUNSEL]` a clause whose enforceability must be confirmed.

---

## 1. Definitions

| Term | Meaning |
| --- | --- |
| **Flyrlink**, "we", "us" | The operating company, to be incorporated in India. Name, CIN and registered office are completed on `M-04a` |
| **Payment Partner** | Razorpay, for collection and payouts within India, and Stripe, for collection from outside India. A Payment Partner is not our agent for the purposes of these Terms |
| **Platform** | The Flyrlink website, applications and APIs |
| **Client** | A user who posts work, engages an Expert, or funds a milestone |
| **Expert** | A user who offers services, accepts engagements, or delivers work |
| **User** | Any account holder, including administrators |
| **Engagement** | A project, its contract, milestones and deliverables |
| **Escrow** | Client funds held **by a Payment Partner**, not by Flyrlink, against a milestone, per the Escrow and Dispute Policy |
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

5.3 You will comply with applicable law, including your own tax obligations. Where Indian
law requires us to withhold or collect tax on a payment we facilitate, we will do so and
will show it on your statement; that is the extent of it. We do not compute, file or pay
your income tax or GST. If you are registered for GST, you remain the supplier of your own
services and are responsible for invoicing and returns. `[COUNSEL]`

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

7.1 **Platform commission is 10% of the amount released on a milestone, charged to the
Expert.** A Client pays the milestone amount and no separate platform fee. Enterprise
Clients may agree different terms in writing. The rate is configured, versioned and
recorded per engagement; an engagement keeps the rate it was priced under, and a change
never applies backwards. `[ENFORCED]`

7.2 Funds are held in escrow and released per that policy. Release is a separate act
requiring an authorised finance role with MFA, refused while a dispute is open.
`[ENFORCED]`

7.3 Payment capture is recognised only from a signature-verified provider webhook. No
redirect, message or administrative action substitutes for it. `[ENFORCED]`

7.4 Amounts are stated exclusive of tax. GST is charged on our commission where
applicable. `[COUNSEL]`

7.5 **Withholding.** As an operator of an electronic platform we are required to withhold
or collect certain amounts on payments we facilitate to residents of India, and to deposit
them against your PAN or GST registration. Those amounts reduce what we remit to you and
are shown, line by line, on your statement. They are not a fee, and we keep none of them.
The applicable rates are set by statute and change; we apply the rate in force.
`[COUNSEL]`

7.6 Chargebacks and reversals are handled per the Escrow and Dispute Policy §7.

7.7 **We do not hold your money.** Funds are held by a Payment Partner in an account it
operates under its own authorisation, and are settled on our instruction. Our records
mirror that balance; they are not a bank account and they are not a claim against us for a
balance we hold. `[ENFORCED]`

---

## 8. Introduction fees and circumvention

> [!CAUTION]
> `[COUNSEL]` **Section 27 of the Indian Contract Act 1872 makes an agreement that restrains
> anyone from exercising a lawful profession or trade void to that extent.** India does not
> apply the reasonableness test that saves narrow post-termination restraints in some other
> countries; the only statutory exception is the sale of goodwill. A clause drafted as
> *"you may not work with this counterparty for 12 months"* is therefore likely to be
> **void, not merely narrowed**, and a void clause is worse than none — it invites a
> declaratory challenge and takes the rest of the section with it in the user's mind.
>
> This section is drafted instead as a **fee for an introduction we actually made**, leaving
> the user free to work with whomever they choose. Counsel must confirm the construction,
> and must confirm the amount is reasonable compensation rather than a penalty under
> section 74.

8.1 **You are free to work with anyone.** Nothing here restricts who you may work with,
when, or on what terms. What follows is about what is **owed to us** where we made the
introduction, not about what you are permitted to do. `[CONTRACTUAL]`

8.2 **Introduction fee.** Where we introduced you to a counterparty and, within **12
months** of that introduction, you invoice or are paid for work with them outside the
Platform that arises from the introduction, an introduction fee becomes payable to us on
that amount. **The fee is the same 10% we would have earned had the work been contracted
here** — never more, so that moving the work off-platform costs you nothing extra and the
fee is a measure of what we lost, not a punishment for leaving. `[CONTRACTUAL]` `[COUNSEL]`

8.3 **When no fee is owed.** No fee arises where: you worked with the counterparty before
Flyrlink and can evidence it; the work is in a different field, unconnected to the
introduction; the 12 months have passed; a buy-out under 8.6 has been paid; or an
enterprise agreement under 8.7 applies. The burden of showing an introduction produced the
work is **ours**, not yours. `[CONTRACTUAL]`

8.4 **What we do treat as misconduct.** Separately from any fee, these breach these Terms:
concealing a matched engagement when asked directly; sharing contact details specifically
to avoid fees before any contract exists; scraping or exporting Platform data to build a
competing roster; and organised, repeated evasion. `[CONTRACTUAL]`

8.5 **Consequences.** Graduated, never automatic, and separate from the fee:

| Finding | Consequence |
| --- | --- |
| Introduced work invoiced off-platform, disclosed | The 8.2 fee, invoiced normally. No account consequence |
| Introduced work concealed when asked | The fee, plus loss of matching priority `[COUNSEL]` |
| Data export or roster building | Feature restriction, and account review |
| Organised or repeated evasion | Termination and permanent removal |

Withdrawing our own matching, priority or features is a decision to stop providing our
service, not a restraint on your trade — and it is the only lever we rely on.

8.6 **Relationship buy-out.** A Client may end any future fee obligation for a counterparty
by paying a one-time buy-out. Once paid, 8.2 no longer applies to that counterparty.
`[BLOCKED — pricing decision]`

> [!NOTE]
> The buy-out amount is an open commercial decision, and is deliberately not invented here.
> The recommended measure is **parity with commission**: never more than what staying on the
> Platform for the remainder of the period would have cost. That keeps it defensible as
> reasonable compensation under section 74, and it is the number a client can check for
> themselves.

8.7 **Enterprise agreement.** An enterprise Client may agree written terms replacing this
section entirely — for example a per-seat or subscription arrangement in which
introductions are not fee-bearing. `[CONTRACTUAL]`

8.8 **Process.** We act on evidence, not suspicion. You will be told what we found and may
respond before any invoice or restriction. Findings, responses and decisions are recorded.
`[CONTRACTUAL]`

---

## 9. Intellectual property in deliverables

9.1 **Before release.** The Expert retains ownership of a deliverable until escrow for
that milestone is released in full. The Client receives a limited, non-transferable
licence to review and evaluate it for approval purposes only. `[CONTRACTUAL]`

9.2 **On release.** On **full release of escrow for the milestone**, the Expert assigns to
the Client all right, title and interest in the deliverables produced for it, including
copyright in every work comprised in them, **for the full term of copyright, throughout
the world, irrevocably, and free of any obligation to exercise the rights within any
period.** The assignment takes effect on release without further act. The consideration
for it is the milestone amount. `[CONTRACTUAL]`

> [!CAUTION]
> `[COUNSEL]` **Every element of 9.2 is there because the Copyright Act 1957 requires it.**
> "Work made for hire" does not exist in Indian law and must never appear in this contract:
> under section 17 the author is the first owner, and the employment exception does not
> reach an independent contractor — so without a valid assignment the Expert keeps the
> copyright, whatever the Client paid. Section 19 then imposes formalities, and the
> defaults for anything left unsaid are hostile to the Client:
>
> | Section | Requirement | Default if the contract is silent |
> | --- | --- | --- |
> | 19(1) | Assignment in writing, signed by the assignor | Not a valid assignment at all |
> | 19(2) | Must identify the work, the rights, the duration and the territory | — |
> | 19(4) | Rights must be exercised within one year | The assignment **lapses** |
> | 19(5) | Duration | Deemed **five years** |
> | 19(6) | Territory | Deemed **India only** |
>
> Two questions for counsel. First, whether recorded electronic acceptance of the contract
> satisfies "in writing signed by the assignor", given the Information Technology Act 2000 —
> if it does not, a separate signed assignment is needed on release and the product must
> produce one. Second, moral rights under section 57 subsist independently of the assignment
> and a blanket waiver is of doubtful effect, so the Client must not be told the Expert has
> given up attribution and integrity rights.

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
security@flyrlink (address to be confirmed with `M-04a`). We will not pursue good-faith
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

12.3 **Governing law.** These Terms and any dispute arising out of them are governed by
the laws of **India**. `[CONTRACTUAL]`

12.4 **Forum.** Subject to 12.5, the courts at the Company's registered office have
exclusive jurisdiction. The city is fixed on incorporation (`M-04a`). `[COUNSEL]`

12.5 **What we do not try to take away.** If you are a consumer, nothing in 12.4 affects
your right to complain to a consumer commission, including where you live, and we will not
argue that an arbitration clause bars you from doing so. `[COUNSEL]`

> [!IMPORTANT]
> `[COUNSEL]` **Do not add a mandatory arbitration clause without advice.** Indian courts
> have held consumer disputes non-arbitrable, so against a consumer the clause achieves
> nothing while signalling that we tried; and the Consumer Protection Act 2019 lets a
> consumer file where they reside, which an exclusive-jurisdiction clause cannot override.
> Arbitration under the Arbitration and Conciliation Act 1996 remains sensible for
> **business-to-business and enterprise** contracts, where it should sit in that agreement
> rather than in these Terms. Class actions are not a feature of Indian procedure in the
> American sense, so a class-action waiver is imported noise — leave it out.

---

## 13. Warranties, liability and indemnity

13.1 The Platform is provided "as is" and "as available", to the extent the law allows.
`[COUNSEL]`

13.2 We do not warrant any Expert's work, any Client's conduct, or the accuracy of any
Agent output.

13.3 **Liability cap.** Our aggregate liability to you for all claims in any 12-month
period is limited to the **platform fees we actually earned from you in that period**. We
exclude indirect, consequential and lost-profit claims. `[COUNSEL]`

13.3.1 **What the cap never covers:** death or personal injury caused by our negligence;
fraud or fraudulent misrepresentation; our own wilful misconduct; and anything that cannot
be limited or excluded under Indian law. `[COUNSEL]`

> [!NOTE]
> `[COUNSEL]` A fee-based cap is the ordinary construction, and it is honest — we take 10%,
> so we cap at 10%. But a consumer commission under the Consumer Protection Act 2019 can
> award compensation irrespective of a contractual cap, and a term that strips a statutory
> remedy risks being read as unfair. Counsel should confirm the cap survives against a
> consumer, and should decide whether to state a floor so the cap is not near zero for a
> user whose only engagement failed.

13.4 You indemnify us against claims arising from your User Content, your breach of these
Terms, your engagements, and your tax or employment-classification obligations.
`[COUNSEL]`

---

## 14. Data protection

14.1 Personal data is handled per the Privacy Policy, which is drafted separately and is
not yet written (`M-05`). These Terms do not substitute for it.

14.2 **Our role.** For the personal data you give us, Flyrlink is a **Data Fiduciary** under
the Digital Personal Data Protection Act 2023 and you are a **Data Principal**. Your
Payment Partner is a fiduciary in its own right for what it collects; we do not see or
store card numbers or payment credentials. `[COUNSEL]`

14.3 **Already true of the system `[ENFORCED]`:** secrets are redacted before anything is
written to the audit trail; audit records are append-only and cannot be edited or deleted
by any role; administrative reads of audit data are scoped to a role's remit; and card
numbers and payment credentials are never stored — only provider references.

14.4 **Your rights.** You may ask for access to your personal data, correction or
completion of it, and erasure where the purpose is served and no legal obligation requires
us to keep it. You may withdraw consent, and withdrawing it will be as straightforward as
giving it was. You may nominate someone to exercise your rights if you die or become
incapacitated. Requests go to the Grievance Officer in §15. `[PROPOSED]`

14.5 **Breach notification.** If a personal-data breach occurs we will notify the Data
Protection Board and the affected Data Principals as the Act requires. `[PROPOSED]`

14.6 **Retention.** We keep personal data while your account is active and afterwards only
as long as a legal, tax, accounting or dispute obligation requires. Financial records and
audit records are subject to statutory retention and are not deleted on request.
`[COUNSEL]`

14.7 **Transfers and payment data.** We may process data outside India except where the
Central Government restricts a country. Payment system data stays subject to the Reserve
Bank's storage requirements and is handled by the Payment Partner within them; we do not
replicate it abroad. `[COUNSEL]`

> [!WARNING]
> **Open gaps, stated plainly.** None of 14.4 to 14.7 is implemented: there is no consent
> notice, no data-principal request path, no breach-notification runbook and no retention
> job. Clause 2.2 requires users to be 18 or over, but nothing verifies age — so a minor
> who signs up puts us in the children's-data provisions we have not planned for. The DPDP
> rules commence in phases, and counsel must confirm which obligations bind us on our launch
> date. `[BLOCKED — `M-05`, plus implementation]`

---

## 15. Grievance redressal, intermediary status and compliance contacts

15.1 **Intermediary status.** For content you post, we act as an intermediary and rely on
the safe harbour in section 79 of the Information Technology Act 2000, subject to the
diligence the Intermediary Guidelines require of us. That protection covers **your**
content; it does not cover our own statements, our commission, or a decision one of our
administrators makes. `[COUNSEL]`

15.2 **Grievance Officer.** We publish the name, designation and contact address of a
Grievance Officer in India, who will acknowledge a complaint and resolve it within the
periods the Intermediary Guidelines and the Consumer Protection (E-Commerce) Rules 2020
require. `[PROPOSED]` — the role is not appointed and the contact address is not published;
both are launch blockers.

15.3 **Nodal Contact Person.** We appoint a Nodal Contact Person for co-ordination with law
enforcement, reachable at all times. `[PROPOSED]`

15.4 **Marketplace duties.** We will not misrepresent a seller, will not manipulate price or
search results to mislead, and will not refuse to take back or refund where the law requires
it. Where an Expert is presented in a ranked shortlist, that ranking is produced
algorithmically and we say so in the interface; the parameters are described in plain terms
and no Expert can pay for position. `[ENFORCED]` for the no-paid-position part — there is no
paid-placement feature — `[PROPOSED]` for published ranking parameters.

> [!NOTE]
> `[COUNSEL]` Ranking transparency is where consumer law and our matching engine meet.
> The E-Commerce Rules prohibit unfair and deceptive practice today; amendments that would
> have mandated explicit ranking-parameter disclosure have been proposed and not notified.
> Counsel should monitor, and Product should assume disclosure is coming rather than retrofit
> it.

---

## 16. Changes and notices

16.1 We may amend these Terms. Material changes take effect no less than **30 days** after
notice, except where a change is required by law or to address a security risk.
`[CONTRACTUAL]`

16.2 Changes do not apply retrospectively to an engagement already contracted; that
engagement keeps the version it was formed under. `[CONTRACTUAL]`

16.3 Notices go to your registered email and are shown in the Platform.

16.4 The company name, CIN, registered office, GSTIN, Grievance Officer and Nodal Contact
Person are completed on `M-04a` and must appear here before publication.

---

## 17. Open items for counsel

All are for **Indian counsel**. The first two decide whether the section they sit in works
at all; the rest are calibration.

| # | Clause | Question |
| --- | --- | --- |
| 1 | §8 | Does the introduction-fee construction avoid section 27 of the Contract Act, and is a fee at parity with commission reasonable compensation under section 74 rather than a penalty? |
| 2 | 9.2 | Does recorded electronic acceptance satisfy section 19(1) of the Copyright Act — "in writing signed by the assignor"? If not, the product must generate a signed assignment on release |
| 3 | 9.2 | Moral rights under section 57: what, if anything, may be waived, and what the Client must be told they are not getting |
| 4 | 12.4–12.5 | Exclusive jurisdiction against a consumer, and whether to keep arbitration for enterprise contracts only |
| 5 | 13.3 | Whether a fee-based cap survives a consumer commission, and whether to state a floor |
| 6 | 5.3, 7.5, 13.4 | Worker classification, and the platform's withholding and reporting exposure — to be run jointly with the chartered accountant |
| 7 | §14 | Which DPDP obligations bind us on the launch date, and the consequence of having no age verification behind clause 2.2 |
| 8 | 15.1–15.4 | Intermediary diligence, Grievance Officer timelines, and whether ranking disclosure should ship ahead of any mandate |
| 9 | Escrow §0 | Confirm the platform is not carrying on an activity that requires payment-aggregator authorisation |
| 10 | Escrow §3 | Whether deemed acceptance on silence is safe under the Consumer Protection Act 2019 |
| 11 | Escrow §7 | Chargeback indemnity enforceability against a consumer |
