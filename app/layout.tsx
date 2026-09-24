/**
 * Root layout.
 *
 * Typography follows the Figma variables: "Font 1" is Mona Sans (every UI and
 * heading style), and "Font 3" is Georgia, used in italic for accent words in
 * headlines. Georgia is a system face, so only Mona Sans is loaded — through
 * next/font, which self-hosts it at build time (no runtime request to Google).
 */

import type { Metadata, Viewport } from 'next';
import { Mona_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const monaSans = Mona_Sans({
  subsets: ['latin'],
  variable: '--font-mona-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Flyrlink — The right expert or team, matched by AI',
    template: '%s · Flyrlink',
  },
  description:
    'Describe what you want to build. Flyrlink structures the brief, estimates the work, and matches you ' +
    'with verified experts — with contracts, milestones and protected payments built in.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={monaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
