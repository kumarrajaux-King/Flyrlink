/**
 * `/login/mfa` — the second factor, on its own URL.
 *
 * WHY A ROUTE RATHER THAN A STAGE ON `/login`
 *   The challenge used to be a `useState` stage inside the sign-in form. It
 *   worked, and it lost the flow on a refresh: the page came back on the
 *   credentials step with a live session cookie already set, so the person
 *   re-entered a password they had just proven. A URL survives a refresh, a
 *   bookmark, and the back button, and it gives the state somewhere to live
 *   that is not React.
 *
 * THIS PAGE DECIDES NOTHING
 *   The gate below is a router, not an authorization decision — it reads what
 *   the server already concluded about the session and sends the person to the
 *   one screen that can move them forward. Every refusal that matters is
 *   enforced again by `authorize`, on every request, whatever this page does.
 *
 *   Four states, four destinations:
 *
 *   | Session                         | Goes to                  |
 *   | ------------------------------- | ------------------------ |
 *   | none, or expired                | `/login` (with `next`)   |
 *   | privileged, no factor enrolled  | the enrollment screen    |
 *   | already cleared                 | `next` — nothing to do   |
 *   | factor enrolled, not cleared    | stays: the challenge     |
 */

import { redirect } from 'next/navigation';

import { MFA_ENROLLMENT_PATH, safeNext } from '../../../../lib/ui/auth-routes';
import { getCurrentUser } from '../../../../lib/http/server-session';
import { MfaChallengeForm } from './mfa-challenge-form';

export const dynamic = 'force-dynamic';

export default async function MfaChallengePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext ?? null);

  const user = await getCurrentUser();

  // No session at all, or one that expired while the code was being fetched.
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  // A privileged account with no second factor cannot answer a challenge —
  // there is nothing generating codes. Send them to set one up.
  if (user.mfaEnrollmentRequired) redirect(MFA_ENROLLMENT_PATH);

  // Nothing outstanding: either they never needed a factor, or this session has
  // already cleared one. Either way they belong wherever they were going.
  if (!user.mfaChallengePending) redirect(next);

  return <MfaChallengeForm next={next} email={user.email} />;
}
