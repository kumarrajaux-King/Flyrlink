/**
 * Layout for the signed-in client workspace.
 *
 * `middleware.ts` has already redirected anyone without a session cookie, but
 * that is a convenience, never the control: every route and service this shell
 * calls re-checks the session server-side. A cookie's presence proves nothing.
 */

import type { ReactNode } from 'react';

import { AppShell } from '../../components/app/app-shell';

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
