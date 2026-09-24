/**
 * Illustrative project analysis for the Home Page preview.
 *
 * This is NOT the Requirements Analyst agent. The real agent (Phase 7) needs an
 * authenticated user, a configured AI provider and the policy engine, and none
 * of that belongs on an anonymous marketing page. This is a deterministic, local
 * keyword heuristic that shows the *shape* of what the agent returns —
 * structured requirements, skills, an advisory range and a team shape. It is
 * labelled as a preview wherever it appears, and nothing typed leaves the
 * browser.
 *
 * Pure and dependency-free so it is unit-testable and safe in a client bundle.
 */

export type PreviewRequirementType = 'OBJECTIVE' | 'SCOPE' | 'DELIVERABLE' | 'CLARIFICATION_QUESTION';
export type PreviewComplexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface PreviewRequirement {
  readonly type: PreviewRequirementType;
  readonly text: string;
}

export interface PreviewTeamRole {
  readonly role: string;
  readonly count: number;
}

export interface PreviewAnalysis {
  readonly projectType: string;
  readonly category: string;
  readonly complexity: PreviewComplexity;
  readonly requirements: readonly PreviewRequirement[];
  readonly skills: readonly string[];
  readonly team: readonly PreviewTeamRole[];
  /** Advisory duration range in weeks — never a quote. */
  readonly durationWeeks: readonly [number, number];
  /** Advisory budget range in INR minor units (paise), per T-03 — never a quote. */
  readonly budgetMinor: readonly [number, number];
  readonly matchedExperts: number;
}

interface Archetype {
  readonly projectType: string;
  readonly category: string;
  readonly keywords: readonly string[];
  readonly skills: readonly string[];
  readonly team: readonly PreviewTeamRole[];
  readonly baseWeeks: readonly [number, number];
  /** Whole rupees; converted to minor units on output. */
  readonly baseBudget: readonly [number, number];
}

const ARCHETYPES: readonly Archetype[] = [
  {
    projectType: 'AI product feature',
    category: 'AI & Machine Learning',
    keywords: ['ai', 'llm', 'gpt', 'chatbot', 'agent', 'machine learning', 'ml', 'recommendation', 'rag'],
    skills: ['Python', 'LLM integration', 'Prompt design', 'TypeScript', 'Vector search'],
    team: [
      { role: 'AI engineer', count: 1 },
      { role: 'Full-stack engineer', count: 1 },
    ],
    baseWeeks: [6, 10],
    baseBudget: [600_000, 1_400_000],
  },
  {
    projectType: 'Mobile app',
    category: 'Mobile Development',
    keywords: ['mobile', 'ios', 'android', 'react native', 'flutter', 'app store'],
    skills: ['React Native', 'TypeScript', 'Mobile UX', 'Node.js', 'Push notifications'],
    team: [
      { role: 'Mobile engineer', count: 1 },
      { role: 'Product designer', count: 1 },
      { role: 'Backend engineer', count: 1 },
    ],
    baseWeeks: [10, 16],
    baseBudget: [900_000, 1_800_000],
  },
  {
    projectType: 'Commerce store',
    category: 'E-commerce',
    keywords: ['ecommerce', 'e-commerce', 'shop', 'store', 'shopify', 'checkout', 'catalog', 'cart'],
    skills: ['Shopify', 'Next.js', 'Payments integration', 'SEO', 'Conversion design'],
    team: [
      { role: 'Commerce engineer', count: 1 },
      { role: 'UI designer', count: 1 },
    ],
    baseWeeks: [6, 10],
    baseBudget: [400_000, 900_000],
  },
  {
    projectType: 'Data & analytics',
    category: 'Data & Analytics',
    keywords: ['data', 'analytics', 'dashboard', 'bi', 'report', 'etl', 'warehouse', 'metrics'],
    skills: ['SQL', 'Python', 'dbt', 'Data visualization', 'PostgreSQL'],
    team: [
      { role: 'Data engineer', count: 1 },
      { role: 'Analytics engineer', count: 1 },
    ],
    baseWeeks: [4, 8],
    baseBudget: [350_000, 800_000],
  },
  {
    projectType: 'Brand & product design',
    category: 'Design',
    keywords: ['design', 'brand', 'logo', 'ui', 'ux', 'figma', 'redesign', 'identity', 'prototype'],
    skills: ['UI/UX Design', 'Figma', 'Design systems', 'User research', 'Prototyping'],
    team: [
      { role: 'Product designer', count: 1 },
      { role: 'Brand designer', count: 1 },
    ],
    baseWeeks: [3, 6],
    baseBudget: [200_000, 550_000],
  },
  {
    projectType: 'Growth marketing',
    category: 'Marketing',
    keywords: ['marketing', 'seo', 'content', 'campaign', 'social', 'ads', 'growth', 'launch'],
    skills: ['SEO', 'Content strategy', 'Performance marketing', 'Analytics', 'Copywriting'],
    team: [
      { role: 'Growth marketer', count: 1 },
      { role: 'Content strategist', count: 1 },
    ],
    baseWeeks: [4, 8],
    baseBudget: [250_000, 600_000],
  },
  {
    projectType: 'Web platform',
    category: 'Web Development',
    keywords: ['web', 'platform', 'saas', 'portal', 'marketplace', 'website', 'app', 'booking', 'crm'],
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Cloud infrastructure'],
    team: [
      { role: 'Full-stack engineer', count: 2 },
      { role: 'Product designer', count: 1 },
    ],
    baseWeeks: [8, 12],
    baseBudget: [700_000, 1_500_000],
  },
];

const FEATURES: readonly { readonly keywords: readonly string[]; readonly scope: string; readonly weight: number }[] = [
  { keywords: ['payment', 'checkout', 'subscription', 'billing', 'escrow'], scope: 'Payments and billing flow', weight: 2 },
  { keywords: ['login', 'account', 'auth', 'sign up', 'roles', 'users'], scope: 'Accounts, sign-in and roles', weight: 1 },
  { keywords: ['chat', 'messaging', 'realtime', 'real-time', 'notification'], scope: 'Messaging and notifications', weight: 2 },
  { keywords: ['admin', 'back office', 'moderation', 'cms'], scope: 'Admin console', weight: 1 },
  { keywords: ['search', 'filter', 'discovery', 'listing'], scope: 'Search and discovery', weight: 1 },
  { keywords: ['integration', 'api', 'crm', 'erp', 'webhook'], scope: 'Third-party integrations', weight: 2 },
  { keywords: ['ai', 'llm', 'recommendation', 'agent', 'chatbot'], scope: 'AI-assisted features', weight: 2 },
  { keywords: ['mobile', 'ios', 'android'], scope: 'Mobile experience', weight: 2 },
];

const DEFAULT_ARCHETYPE: Archetype = {
  projectType: 'Custom project',
  category: 'General',
  keywords: [],
  skills: ['Product strategy', 'Solution architecture', 'Project delivery'],
  team: [{ role: 'Solution architect', count: 1 }],
  baseWeeks: [4, 8],
  baseBudget: [250_000, 700_000],
};

const COMPLEXITY_ORDER: readonly PreviewComplexity[] = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
const COMPLEXITY_FACTOR: Record<PreviewComplexity, number> = { LOW: 0.7, MEDIUM: 1, HIGH: 1.4, VERY_HIGH: 1.9 };

function mentions(text: string, keyword: string): boolean {
  // Whole-word match — so "ai" does not fire on "email" or "maintain" — that
  // still accepts a plural ("payments", "dashboards").
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?:s|es)?([^a-z0-9]|$)`).test(text);
}

const MENTIONS_TIMELINE = /\b(weeks?|months?|deadline|launch(es|ing)?|q[1-4]|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/;
// Word-bounded, so "rs" inside "tutors" is not mistaken for rupees.
const MENTIONS_BUDGET = /\b(budget|inr|rs|lakhs?|crores?|usd)\b|₹|\$|\b\d+\s?k\b/;

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/** A brief this short cannot be analysed meaningfully. */
export const MIN_BRIEF_LENGTH = 12;

export function analyseBrief(brief: string): PreviewAnalysis | null {
  const text = brief.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text.length < MIN_BRIEF_LENGTH) return null;

  let archetype = DEFAULT_ARCHETYPE;
  let bestScore = 0;
  for (const candidate of ARCHETYPES) {
    const score = candidate.keywords.filter((keyword) => mentions(text, keyword)).length;
    if (score > bestScore) {
      archetype = candidate;
      bestScore = score;
    }
  }

  const features = FEATURES.filter((feature) => feature.keywords.some((keyword) => mentions(text, keyword)));
  const featureWeight = features.reduce((sum, feature) => sum + feature.weight, 0);
  const lengthWeight = text.length > 280 ? 2 : text.length > 120 ? 1 : 0;
  const complexity = COMPLEXITY_ORDER[Math.min(3, Math.floor((featureWeight + lengthWeight) / 2))] ?? 'MEDIUM';
  const factor = COMPLEXITY_FACTOR[complexity];

  const objective = brief.trim().replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? brief.trim();
  const requirements: PreviewRequirement[] = [
    { type: 'OBJECTIVE', text: objective.length > 140 ? `${objective.slice(0, 137).trimEnd()}…` : objective },
    ...(features.length > 0
      ? features.slice(0, 3).map((feature) => ({ type: 'SCOPE' as const, text: feature.scope }))
      : [{ type: 'SCOPE' as const, text: `Core ${archetype.projectType.toLowerCase()} scope` }]),
    { type: 'DELIVERABLE', text: 'Milestone plan with acceptance criteria' },
  ];

  if (!MENTIONS_TIMELINE.test(text)) {
    requirements.push({ type: 'CLARIFICATION_QUESTION', text: 'When do you need the first release live?' });
  }
  if (!MENTIONS_BUDGET.test(text)) {
    requirements.push({ type: 'CLARIFICATION_QUESTION', text: 'Is there a budget range we should plan within?' });
  }

  const [minWeeks, maxWeeks] = archetype.baseWeeks;
  const [minBudget, maxBudget] = archetype.baseBudget;

  return {
    projectType: archetype.projectType,
    category: archetype.category,
    complexity,
    requirements,
    skills: archetype.skills,
    team: archetype.team,
    durationWeeks: [Math.max(1, Math.round(minWeeks * factor)), Math.max(2, Math.round(maxWeeks * factor))],
    budgetMinor: [roundTo(minBudget * factor, 10_000) * 100, roundTo(maxBudget * factor, 10_000) * 100],
    // Deterministic, so the same brief always shows the same preview.
    matchedExperts: 8 + ((text.length * 7 + featureWeight * 3) % 17),
  };
}
