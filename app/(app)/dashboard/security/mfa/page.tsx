/**
 * `/dashboard/security/mfa` — set up a second factor.
 *
 * GATED ON BEING SIGNED IN, AND NOTHING MORE
 *   Deliberately `requireUser` rather than a permission gate. `authorize`
 *   applies the MFA rule to the *actor*, not to the permission, so an
 *   administrator who has not cleared a factor holds no usable permission at
 *   all — not even their own customer grants. A permission gate here would
 *   refuse exactly the person the screen exists for, and send them back to a
 *   dashboard telling them to come here.
 *
 *   Nothing is lost by that: the screen acts only on the signed-in account's
 *   own factor, through endpoints that take the user from the session and
 *   never from the page.
 */

import { requireUser } from '../../../../../lib/http/server-session';
import { MfaEnrollment } from './mfa-enrollment';

export const dynamic = 'force-dynamic';

const PATH = '/dashboard/security/mfa';

export default async function MfaSecurityPage() {
  const user = await requireUser(PATH);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-brand-600 uppercase ring-1 ring-line">
          Security
        </span>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink">
          Two-factor authentication
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-ink-muted">
          {user.mfaEnrollmentRequired
            ? 'Your role requires a second factor. Until one is set up, this account can sign in but cannot do anything privileged.'
            : 'A code from your phone, on top of your password. Recommended for every account, required for privileged ones.'}
        </p>
      </header>

      <MfaEnrollment
        alreadyEnabled={user.mfaEnabled}
        required={user.mfaEnrollmentRequired}
        email={user.email}
      />
    </div>
  );
}
