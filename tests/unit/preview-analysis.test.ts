import { describe, expect, it } from 'vitest';

import { MIN_BRIEF_LENGTH, analyseBrief } from '../../lib/marketing/preview-analysis';

describe('home page preview analysis (illustrative, not the AI agent)', () => {
  it('declines to analyse a brief that is too short to mean anything', () => {
    expect(analyseBrief('')).toBeNull();
    expect(analyseBrief('   app   ')).toBeNull();
    expect(analyseBrief('x'.repeat(MIN_BRIEF_LENGTH - 1))).toBeNull();
  });

  it.each([
    ['A marketplace web platform where clients hire designers, with payments and chat', 'Web platform'],
    ['An AI chatbot that answers support questions from our docs using an LLM', 'AI product feature'],
    ['An iOS and Android mobile app for booking fitness classes', 'Mobile app'],
    ['A Shopify store with a custom checkout for our coffee brand', 'Commerce store'],
    ['A new brand identity, logo and Figma design system for our startup', 'Brand & product design'],
    ['An analytics dashboard over our sales data warehouse with weekly metrics', 'Data & analytics'],
    ['SEO and content marketing campaign for our product launch', 'Growth marketing'],
    ['Something bespoke we would like to discuss in detail', 'Custom project'],
  ])('classifies "%s" as %s', (brief, projectType) => {
    expect(analyseBrief(brief)?.projectType).toBe(projectType);
  });

  it('matches whole words, so "email" does not look like an AI project', () => {
    expect(analyseBrief('Improve our email newsletter signup website')?.projectType).toBe('Web platform');
  });

  it('structures the brief the way the requirements agent does', () => {
    const analysis = analyseBrief('A marketplace platform with payments, messaging and an admin console.');
    expect(analysis).not.toBeNull();
    const types = analysis!.requirements.map((requirement) => requirement.type);
    expect(types[0]).toBe('OBJECTIVE');
    expect(types).toContain('SCOPE');
    expect(types).toContain('DELIVERABLE');
    expect(analysis!.requirements.filter((r) => r.type === 'SCOPE').map((r) => r.text)).toEqual([
      'Payments and billing flow',
      'Messaging and notifications',
      'Admin console',
    ]);
  });

  it('asks a clarifying question only when the brief leaves something out', () => {
    const vague = analyseBrief('A marketplace platform for local tutors');
    expect(vague!.requirements.filter((r) => r.type === 'CLARIFICATION_QUESTION')).toHaveLength(2);

    const specific = analyseBrief('A marketplace platform for tutors, launch in 8 weeks, budget ₹10 lakh');
    expect(specific!.requirements.filter((r) => r.type === 'CLARIFICATION_QUESTION')).toHaveLength(0);
  });

  it('scales advisory ranges with complexity and keeps them coherent', () => {
    const simple = analyseBrief('A simple website for our bakery')!;
    const complex = analyseBrief(
      'A marketplace platform with payments, subscriptions, real-time chat, an admin console, CRM integration, ' +
        'AI recommendations and native mobile apps for iOS and Android, supporting thousands of vendors.',
    )!;

    for (const analysis of [simple, complex]) {
      expect(analysis.durationWeeks[0]).toBeLessThanOrEqual(analysis.durationWeeks[1]);
      expect(analysis.budgetMinor[0]).toBeLessThanOrEqual(analysis.budgetMinor[1]);
      // Minor units, whole rupees.
      expect(analysis.budgetMinor[0] % 100).toBe(0);
    }
    expect(complex.complexity).not.toBe('LOW');
    expect(complex.budgetMinor[1]).toBeGreaterThan(simple.budgetMinor[1]);
  });

  it('is deterministic — the same brief always previews the same result', () => {
    const brief = 'An AI assistant for our legal team to review contracts';
    expect(analyseBrief(brief)).toEqual(analyseBrief(brief));
  });
});
