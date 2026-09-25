/**
 * Site footer — the Figma dark navy footer: brand column, link columns, the
 * "Stay in the loop" row and a bottom bar. Links that point at screens outside
 * this preview are shown as "Soon" rather than as dead links.
 */

import { Container } from '../ui/container';
import { Logo } from '../ui/logo';
import { Accent } from '../ui/section-heading';
import { NewsletterPreview } from './newsletter-preview';

interface FooterLink {
  readonly label: string;
  readonly href?: string;
}

const COLUMNS: readonly { readonly title: string; readonly links: readonly FooterLink[] }[] = [
  {
    title: 'Platform',
    links: [
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Discover Experts', href: '#experts' },
      { label: 'Verification', href: '#verification' },
      { label: 'Escrow & Security', href: '#escrow' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'For experts',
    links: [
      { label: 'Become an Expert', href: '#become-an-expert' },
      { label: 'How matching works', href: '#how-it-works' },
      { label: 'Expert guidelines' },
    ],
  },
  {
    title: 'Company',
    links: [{ label: 'About' }, { label: 'Careers' }, { label: 'Terms' }, { label: 'Privacy' }],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-navy-900 text-white/65">
      <Container className="grid grid-cols-1 gap-12 pt-20 pb-12 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex max-w-sm flex-col gap-5">
          <Logo tone="dark" />
          <p className="text-sm leading-relaxed">
            The AI-agentic talent marketplace. Describe an outcome; we structure it, match verified experts, and
            protect every milestone.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-4">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">{column.title}</p>
            <ul className="flex flex-col gap-3 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.href ? (
                    <a href={link.href} className="transition-colors hover:text-white">
                      {link.label}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-white/45">
                      {link.label}
                      <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] tracking-wide text-white/50">
                        Soon
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>

      <Container>
        <div className="flex flex-col gap-6 border-t border-white/10 py-10 md:flex-row md:items-center md:justify-between">
          <p className="text-2xl font-semibold tracking-[-0.03em] text-white">
            Stay in the <Accent className="text-accent-300">loop.</Accent>
          </p>
          <NewsletterPreview />
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 py-8 text-[13px] text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Flyrlink. All rights reserved.</p>
          <p>Preview build — sample content is labelled.</p>
        </div>
      </Container>
    </footer>
  );
}
