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
  /** Illustrative count of verified experts. */
  readonly experts: number;
  readonly topSkills: readonly string[];
}

export const SAMPLE_CATEGORIES: readonly SampleCategory[] = [
  { name: 'Web Development', icon: 'code', experts: 184, topSkills: ['React', 'Node.js', 'Next.js'] },
  { name: 'AI & Machine Learning', icon: 'brain', experts: 96, topSkills: ['LLMs', 'Python', 'MLOps'] },
  { name: 'Product Design', icon: 'pen', experts: 128, topSkills: ['UI/UX', 'Figma', 'Research'] },
  { name: 'Mobile Apps', icon: 'smartphone', experts: 73, topSkills: ['React Native', 'Swift', 'Kotlin'] },
  { name: 'Data & Analytics', icon: 'chart', experts: 81, topSkills: ['SQL', 'dbt', 'BI'] },
  { name: 'Cloud & DevOps', icon: 'cloud', experts: 64, topSkills: ['AWS', 'Kubernetes', 'Terraform'] },
  { name: 'Growth Marketing', icon: 'trending', experts: 110, topSkills: ['SEO', 'Paid', 'Content'] },
  { name: 'Cybersecurity', icon: 'shield', experts: 42, topSkills: ['AppSec', 'Audits', 'Compliance'] },
];

/** Illustrative marketplace figures for the preview. */
export const SAMPLE_FIGURES = [
  { value: '780+', label: 'Verified experts' },
  { value: '4.9', label: 'Average rating' },
  { value: '48h', label: 'Median time to match' },
] as const;

export const SAMPLE_BRIEFS: readonly string[] = [
  'A marketplace web app with escrow payments and messaging',
  'An AI assistant that answers customer questions from our docs',
  'A mobile app for booking and paying for fitness classes',
  'A brand identity and design system for our fintech startup',
];

// ---------------------------------------------------------------------------
// Product facts (implemented architecture)
// ---------------------------------------------------------------------------

export interface ProcessStep {
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly icon: IconKey;
}

/** Mirrors the Project lifecycle (STEP 02 §10.1) from submission to completion. */
export const PROCESS_STEPS: readonly ProcessStep[] = [
  {
    title: 'Describe',
    description: 'Tell us the outcome you want, in your own words.',
    detail: 'No specification needed',
    icon: 'messages',
  },
  {
    title: 'AI analyzes',
    description: 'Agents structure requirements, surface gaps and estimate effort.',
    detail: 'You review and edit every line',
    icon: 'sparkles',
  },
  {
    title: 'Match',
    description: 'Ranked, explained recommendations of verified experts or teams.',
    detail: 'Every score shows its reasons',
    icon: 'target',
  },
  {
    title: 'Collaborate',
    description: 'A signed contract, milestones and funds held securely until approval.',
    detail: 'Terms are versioned and immutable',
    icon: 'fileSignature',
  },
  {
    title: 'Complete',
    description: 'Approve deliverables, release payment and leave a verified review.',
    detail: 'Release only on your approval',
    icon: 'badgeCheck',
  },
];

export interface Capability {
  readonly title: string;
  readonly description: string;
  readonly output: string;
  readonly icon: IconKey;
}

/** Each maps to an implemented Phase 7 agent. */
export const AI_CAPABILITIES: readonly Capability[] = [
  {
    title: 'Project Analysis',
    description: 'Turns a described outcome into objectives, scope and deliverables.',
    output: 'Structured project brief',
    icon: 'sparkles',
  },
  {
    title: 'Requirements',
    description: 'Finds gaps, conflicts and untestable criteria before work begins.',
    output: 'Requirements with open questions',
    icon: 'listChecks',
  },
  {
    title: 'Estimation',
    description: 'Advisory ranges for effort, timeline, budget and team size — with assumptions.',
    output: 'Ranges, never quotes',
    icon: 'calculator',
  },
  {
    title: 'Talent Matching',
    description: 'Scores verified experts on skills, delivery history, availability and fit.',
    output: 'Explained recommendations',
    icon: 'target',
  },
  {
    title: 'Team Building',
    description: 'Composes complementary teams when one expert is not enough.',
    output: 'Proposed team shape',
    icon: 'users',
  },
  {
    title: 'Risk Monitoring',
    description: 'Watches deadlines, revisions and inactivity, and flags risk early.',
    output: 'Early, reversible alerts',
    icon: 'radar',
  },
];

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
    description: 'Funds are held until you approve the work, confirmed by the payment provider — never a redirect.',
    icon: 'wallet',
  },
  {
    title: 'Reviews & reputation',
    description: 'Only completed, paid engagements can leave a review, so reputation reflects real work.',
    icon: 'star',
  },
];
