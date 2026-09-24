/**
 * Cross-component events for the Home Page preview.
 *
 * Window events keep otherwise unrelated islands decoupled — a hero chip and
 * the composer further down the page; any button and the notice toast —
 * without introducing a global store for a single page.
 */

export const BRIEF_EVENT = 'flyrlink:brief';
export const PREVIEW_NOTICE_EVENT = 'flyrlink:preview-notice';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fill the composer with a brief, run the preview analysis, and bring it into view. */
export function requestBriefAnalysis(brief: string): void {
  window.dispatchEvent(new CustomEvent<string>(BRIEF_EVENT, { detail: brief }));
  document
    .getElementById('describe')
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

export function announcePreview(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(PREVIEW_NOTICE_EVENT, { detail: message }));
}

/** What a preview-only action says instead of pretending to work. */
export const PREVIEW_MESSAGES = {
  signIn: 'Sign-in arrives with the account screens. This build is a Home Page preview.',
  browseExperts: 'The full Browse Experts screen is a later phase. The profiles on this page are a preview.',
  postProject: 'Posting a project opens with the project flow. Nothing was sent or saved.',
  becomeExpert: 'Expert applications open with expert onboarding. Nothing was submitted.',
  expertProfile: 'Expert profile pages arrive with Browse Experts.',
  newsletter: 'Newsletter sign-up is not connected in this preview. Nothing was sent or stored.',
  footerLink: 'That page is not part of the Home Page preview.',
} as const;
