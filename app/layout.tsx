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
    // Page titles follow landing-pages.md §8: "<page title> | Flyrlink".
    default: 'Hire verified experts, matched by AI | Flyrlink',
    template: '%s | Flyrlink',
  },
  description:
    'Describe your project and get a shortlist of verified experts, with milestone escrow and contracts built in.',
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
