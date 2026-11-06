/**
 * Home Page content.
 *
 * Two kinds of content live here, and the difference matters:
 *
 *   PRODUCT FACTS — the steps, AI capabilities and trust controls describe what
 *   the platform actually does. Each maps to implemented architecture: the
 *   Phase 7 agents, and the Phase 6 contract, milestone and payment state
 *   machines.
 *
 *   SAMPLE CONTENT — the expert profiles, category counts and marketplace
 *   figures are illustrative. No person, rating, review or statistic in the
 *   `SAMPLE_*` exports is real, and every place that renders them says so. Live
 *   platform data comes from `services/marketplace/home-showcase.ts`.
 */

import type { AvatarTone } from '../../ui/avatar';
import type { IconKey } from '../../ui/icon';

export type { AvatarTone, IconKey };

// ---------------------------------------------------------------------------
// Sample content (illustrative)
// ---------------------------------------------------------------------------

export interface SampleExpert {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly headline: string;
  readonly category: string;
  readonly yearsOfExperience: number;
  readonly skills: readonly string[];
  readonly rating: number;
  readonly reviewCount: number;
  readonly completedProjects: number;
  /** INR minor units, as a string. */
  readonly hourlyRateMinor: string;
  readonly availability: 'AVAILABLE' | 'PARTIALLY_AVAILABLE';
  /** Illustrative AI match score, 0–100. */
  readonly matchScore: number;
  readonly matchReason: string;
  readonly tone: AvatarTone;
}

export const SAMPLE_EXPERTS: readonly SampleExpert[] = [
  {
    id: 'sample-ananya',
    displayName: 'Ananya R.',
    initials: 'AR',
    headline: 'Senior full-stack engineer — SaaS platforms',
    category: 'Web Development',
    yearsOfExperience: 9,
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
    rating: 4.9,
    reviewCount: 64,
    completedProjects: 41,
    hourlyRateMinor: '420000',
    availability: 'AVAILABLE',
    matchScore: 96,
    matchReason: 'Shipped 3 marketplaces with escrow payments',
    tone: 'sky',
  },
  {
    id: 'sample-marcus',
    displayName: 'Marcus L.',
    initials: 'ML',
    headline: 'AI engineer — LLM products and retrieval',
    category: 'AI & Machine Learning',
    yearsOfExperience: 7,
    skills: ['Python', 'LLM integration', 'RAG', 'AWS'],
    rating: 4.9,
    reviewCount: 38,
    completedProjects: 27,
    hourlyRateMinor: '550000',
    availability: 'AVAILABLE',
    matchScore: 94,
    matchReason: 'Built production agents with human review',
    tone: 'indigo',
  },
  {
    id: 'sample-priya',
    displayName: 'Priya N.',
    initials: 'PN',
    headline: 'Product designer — marketplaces and fintech',
    category: 'Product Design',
    yearsOfExperience: 8,
    skills: ['UI/UX Design', 'Figma', 'Design systems', 'User research'],
    rating: 5.0,
    reviewCount: 52,
    completedProjects: 36,
    hourlyRateMinor: '300000',
    availability: 'PARTIALLY_AVAILABLE',
    matchScore: 91,
    matchReason: 'Design systems for two-sided products',
    tone: 'teal',
  },
  {
    id: 'sample-daniel',
    displayName: 'Daniel O.',
    initials: 'DO',
    headline: 'Mobile engineer — iOS and Android',
    category: 'Mobile Apps',
    yearsOfExperience: 6,
    skills: ['React Native', 'Swift', 'Kotlin', 'Firebase'],
    rating: 4.8,
    reviewCount: 29,
    completedProjects: 22,
    hourlyRateMinor: '380000',
    availability: 'AVAILABLE',
    matchScore: 89,
    matchReason: 'Launched 5 apps with offline sync',
    tone: 'amber',
  },
  {
    id: 'sample-sofia',
    displayName: 'Sofia M.',
    initials: 'SM',
    headline: 'Data engineer — analytics platforms',
    category: 'Data & Analytics',
    yearsOfExperience: 10,
    skills: ['SQL', 'dbt', 'Python', 'Snowflake'],
    rating: 4.9,
    reviewCount: 47,
    completedProjects: 33,
    hourlyRateMinor: '450000',
    availability: 'AVAILABLE',
    matchScore: 87,
    matchReason: 'Modern data stacks for Series A–C teams',
    tone: 'rose',
  },
  {
    id: 'sample-rahul',
    displayName: 'Rahul K.',
    initials: 'RK',
    headline: 'Growth marketer — B2B SaaS',
    category: 'Growth Marketing',
    yearsOfExperience: 8,
    skills: ['SEO', 'Performance marketing', 'Analytics', 'Content strategy'],
    rating: 4.8,
    reviewCount: 58,
    completedProjects: 44,
    hourlyRateMinor: '260000',
    availability: 'PARTIALLY_AVAILABLE',
    matchScore: 85,
    matchReason: 'Grew pipeline 3× for developer tools',
    tone: 'slate',
  },
];

export interface SampleCategory {
  readonly name: string;
  readonly icon: IconKey;
  readonly topSkills: readonly string[];
}

export const SAMPLE_CATEGORIES: readonly SampleCategory[] = [
  { name: 'Web Development', icon: 'code', topSkills: ['React', 'Node.js', 'Next.js'] },
  { name: 'AI & Machine Learning', icon: 'brain', topSkills: ['LLMs', 'Python', 'MLOps'] },
  { name: 'Product Design', icon: 'pen', topSkills: ['UI/UX', 'Figma', 'Research'] },
  { name: 'Mobile Apps', icon: 'smartphone', topSkills: ['React Native', 'Swift', 'Kotlin'] },
  { name: 'Data & Analytics', icon: 'chart', topSkills: ['SQL', 'dbt', 'BI'] },
  { name: 'Cloud & DevOps', icon: 'cloud', topSkills: ['AWS', 'Kubernetes', 'Terraform'] },
  { name: 'Growth Marketing', icon: 'trending', topSkills: ['SEO', 'Paid', 'Content'] },
  { name: 'Cybersecurity', icon: 'shield', topSkills: ['AppSec', 'Audits', 'Compliance'] },
];

export const SAMPLE_BRIEFS: readonly string[] = [
  'A marketplace web app with escrow payments and messaging',
  'An AI assistant that answers customer questions from our docs',
  'A mobile app for booking and paying for fitness classes',
  'A brand identity and design system for our fintech startup',
];

// ---------------------------------------------------------------------------
// Product facts (implemented architecture)
// ---------------------------------------------------------------------------

export interface TrustPillar {
  readonly title: string;
  readonly description: string;
  readonly icon: IconKey;
}

/** Each maps to implemented controls (STEP 03 schema, Phase 6 lifecycle). */
export const TRUST_PILLARS: readonly TrustPillar[] = [
  {
    title: 'Verified experts',
    description: 'Identity, skills and portfolio are reviewed by our verification team. AI assists; people decide.',
    icon: 'badgeCheck',
  },
  {
    title: 'Secure contracts',
    description: 'Scope and terms are versioned. Once both sides sign, the terms cannot be silently changed.',
    icon: 'fileSignature',
  },
  {
    title: 'Milestones',
    description: 'Work is split into milestones with acceptance criteria, reviewed before approval.',
    icon: 'milestone',
  },
  {
    title: 'Protected payments',
    description:
      'Funds are held by our payment partner until you approve the work, and a capture is recorded only from a ' +
      'signature-verified provider webhook — never a browser redirect.',
    icon: 'wallet',
  },
  {
    title: 'Reviews & reputation',
    description: 'Only completed, paid engagements can leave a review, so reputation reflects real work.',
    icon: 'star',
  },
];

// ---------------------------------------------------------------------------
// Landing copy (docs/content/landing-pages.md)
// ---------------------------------------------------------------------------

/**
 * The three hero audiences from §2.
 *
 * The client hero is the default and the only one with an `<h1>` on this page —
 * the expert and enterprise heroes have their own routes (`/for-experts`,
 * `/enterprise`). Here they are a preview of that copy, swapped in place, so a
 * reviewer can read all three without leaving the page.
 */
export interface HeroAudience {
  readonly key: 'CLIENT' | 'EXPERT' | 'ENTERPRISE';
  readonly tab: string;
  readonly route: string;
  readonly headline: string;
  /** Set in the accent face, closing the headline. */
  readonly headlineAccent: string;
  readonly subhead: string;
  readonly primaryCta: string;
  readonly secondaryCta: string;
  readonly assurances: readonly string[];
}

export const HERO_AUDIENCES: readonly HeroAudience[] = [
  {
    key: 'CLIENT',
    tab: 'For clients',
    route: '/',
    headline: 'Describe the outcome.',
    headlineAccent: 'Meet the right expert.',
    subhead:
      "Flyrlink's agents turn your brief into a structured scope, estimate the work and shortlist verified " +
      'experts — while milestone escrow keeps your money under your control until you approve the work.',
    primaryCta: 'Find an Expert',
    secondaryCta: 'Post a Project',
    assurances: ['Experts verified by people', 'AI you can review and edit', 'Paid only on your approval'],
  },
  {
    key: 'EXPERT',
    tab: 'For experts',
    route: '/for-experts',
    headline: 'Get matched to',
    headlineAccent: 'funded work.',
    subhead:
      'No bidding wars. Flyrlink matches your verified skill stack to briefs that fit, and the client funds ' +
      'the milestone before you start.',
    primaryCta: 'Apply as an Expert',
    secondaryCta: 'See how matching works',
    assurances: ['Milestones funded before work begins', 'Scope agreed in writing', 'Verification you keep'],
  },
  {
    key: 'ENTERPRISE',
    tab: 'For enterprise',
    route: '/enterprise',
    headline: 'Talent procurement with',
    headlineAccent: 'an audit trail.',
    subhead:
      'Role-separated administration, verified suppliers, milestone escrow and an append-only record of every ' +
      'decision — the controls your finance and compliance teams ask for, available from day one.',
    primaryCta: 'Talk to us',
    secondaryCta: 'Read the governance overview',
    assurances: ['Role separation enforced server-side', 'Append-only decision record', 'Dispute process with evidence review'],
  },
];

/**
 * The engine, §3. Each step pairs what the client sees with what runs
 * underneath — the pairing is the point: it is what makes "thirteen agents"
 * inspectable rather than a boast.
 */
export interface EngineStep {
  readonly number: string;
  readonly title: string;
  readonly seen: string;
  readonly underneath: string;
  /** The agents or records involved, named as they are in the architecture. */
  readonly machinery: readonly string[];
  readonly icon: IconKey;
}

export const ENGINE_STEPS: readonly EngineStep[] = [
  {
    number: '01',
    title: 'Describe',
    seen: 'A plain-language brief box. No specification, no template, no forms to fight.',
    underneath: 'Two agents read the brief and structure it into objectives, scope and deliverables.',
    machinery: ['PROJECT_ARCHITECT', 'REQUIREMENTS_ANALYST'],
    icon: 'messages',
  },
  {
    number: '02',
    title: 'Analyse',
    seen: 'Objectives, scope, deliverables and open questions — all of it editable by you.',
    underneath:
      'Each line is a ProjectRequirement marked as AI-authored. Every edit you make is recorded against your name.',
    machinery: ['ProjectRequirement', 'ContentSource.AI_AGENT'],
    icon: 'listChecks',
  },
  {
    number: '03',
    title: 'Estimate',
    seen: 'Effort, duration and a budget range, with the assumptions behind them stated.',
    underneath: 'Ranges are advisory and never a quote. An expert’s proposal may differ, and often does.',
    machinery: ['ESTIMATION'],
    icon: 'calculator',
  },
  {
    number: '04',
    title: 'Match',
    seen: 'A ranked shortlist, each with a score breakdown and the evidence behind it.',
    underneath:
      'Recommendation rows carry per-dimension scores. A score with no evidence trail is not shown at all.',
    machinery: ['TALENT_DISCOVERY', 'MATCHING'],
    icon: 'target',
  },
  {
    number: '05',
    title: 'Approve',
    seen: 'You choose. The expert accepts. A contract is drafted from what you both agreed.',
    underneath:
      'Your approval moves the project to ASSIGNMENT_PENDING. The expert’s acceptance is their own act, not an automation.',
    machinery: ['Project lifecycle', 'Contract'],
    icon: 'fileSignature',
  },
];

/** Verification, §4. What is checked, how, and what the public actually sees. */
export interface VerificationRow {
  readonly checked: string;
  readonly how: string;
  readonly shown: string;
}

export const VERIFICATION_ROWS: readonly VerificationRow[] = [
  {
    checked: 'Identity and account standing',
    how: 'Document review by a verification manager',
    shown: 'The verified badge',
  },
  {
    checked: 'Credentials and certifications',
    how: 'Issuer, credential id and expiry captured per certification',
    shown: 'Certification list with status',
  },
  {
    checked: 'Portfolio and experience',
    how: 'A reviewer inspects the submitted evidence',
    shown: 'Portfolio, years of experience, skill proficiency',
  },
  {
    checked: 'Consistency signals',
    how: 'The VERIFICATION agent flags inconsistencies for the reviewer',
    shown: 'Nothing. Flags are internal and advisory',
  },
];

/** Escrow, §5. Five stages, and what the client controls at each. */
export interface EscrowStage {
  readonly stage: string;
  readonly happens: string;
  readonly control: string;
  readonly icon: IconKey;
}

export const ESCROW_STAGES: readonly EscrowStage[] = [
  {
    stage: 'Fund',
    happens: 'The client funds a milestone before work starts.',
    control: 'Money moves into escrow, not to the expert.',
    icon: 'wallet',
  },
  {
    stage: 'Work',
    happens: 'The expert delivers against written acceptance criteria.',
    control: 'Progress and deliverables stay visible.',
    icon: 'milestone',
  },
  {
    stage: 'Review',
    happens: 'You approve, or request a revision.',
    control: 'The approval is yours. An administrator may act only through a recorded, justified intervention.',
    icon: 'listChecks',
  },
  {
    stage: 'Release',
    happens: 'Funds are released to the expert.',
    control: 'A separate, finance-approved step, blocked while a dispute is open.',
    icon: 'badgeCheck',
  },
  {
    stage: 'Dispute',
    happens: 'Either side may raise a dispute.',
    control: 'Release is frozen across the project until the dispute is decided.',
    icon: 'shield',
  },
];

/** §5 security proof points. Every one of these is implemented today. */
export const SECURITY_PROOFS: readonly string[] = [
  'A payment is recorded as captured only from a signature-verified provider webhook. No client redirect and no administrator can substitute for it.',
  'Escrow release requires a finance role with multi-factor authentication, and is refused while any dispute on the project is open.',
  'Administrative actions require a written reason and explicit confirmation of the state being changed, and are written to an append-only audit record.',
  'Administrators cannot act on their own account, and cannot decide a matter they are a party to.',
];

/** Pricing, §6. */
export interface PricingRow {
  readonly who: string;
  readonly pays: string;
  readonly when: string;
}

export const PRICING_ROWS: readonly PricingRow[] = [
  { who: 'Client', pays: 'The milestone amount', when: 'On funding, before work starts' },
  { who: 'Expert', pays: '10% of each milestone released', when: 'On release, deducted from the payout' },
  { who: 'Enterprise', pays: 'Agreed in the contract', when: 'Per contract' },
];

/** The commission rate, as a fraction. One constant, used by copy and calculator alike. */
export const COMMISSION_RATE = 0.1;

/** §7.2 trust badges. */
export interface TrustBadge {
  readonly title: string;
  readonly description: string;
  readonly icon: IconKey;
}

export const TRUST_BADGES: readonly TrustBadge[] = [
  {
    title: 'Verified by people',
    description: 'Identity, credentials and portfolio reviewed by a verification manager.',
    icon: 'badgeCheck',
  },
  {
    title: 'Milestone escrow',
    description: 'Funded before work starts, released on your approval.',
    icon: 'wallet',
  },
  {
    title: 'Dispute cover',
    description: 'A three-stage process with evidence review.',
    icon: 'shield',
  },
  {
    title: 'Audit trail',
    description: 'Every decision recorded, with who made it and why.',
    icon: 'fileText',
  },
];

/**
 * §7.3 tooltips.
 *
 * One definition per term, used everywhere the term appears. A glossary that
 * lives in two places drifts, and a marketplace where "escrow" means something
 * slightly different on two screens has a trust problem, not a copy problem.
 */
export const TOOLTIPS = {
  escrow:
    "Your payment is held by the platform's payment provider and released to the expert only after you approve the milestone.",
  milestone: 'A defined piece of work with its own scope, acceptance criteria and amount.',
  matchScore:
    'How well an expert fits this brief across skills, experience, availability, budget fit and past performance. Open it to see the evidence.',
  verified:
    "A verification manager reviewed this expert's identity, credentials and portfolio. Verification can be withdrawn.",
  advisoryEstimate:
    'A range produced from your brief and comparable work. It is not a quote, and an expert’s proposal may differ.',
  inspectionPeriod: 'The window for reviewing a delivery before it is treated as accepted.',
} as const;

export type TooltipTerm = keyof typeof TOOLTIPS;
