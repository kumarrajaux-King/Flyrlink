'use client';

/**
 * Site header — the Figma public navigation (logo · links · sign in · primary
 * CTA), adapted to the product's four entry points. Transparent over the hero,
 * it gains a translucent white ground and a hairline once the page scrolls.
 * Below `lg` the links move into a full-height sheet.
 */

import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '../../lib/ui/cn';
import { ButtonArrow, ButtonLink } from '../ui/button';
import { Container } from '../ui/container';
import { Logo } from '../ui/logo';
import { PreviewActionButton } from './preview-action';
import { PREVIEW_MESSAGES } from './preview-events';

/**
 * Primary navigation.
 *
 * These are the public-zone destinations from the information architecture
 * (§3) — how it works, experts, trust, pricing, for experts — pointed at the
 * sections of this page that stand in for them until those routes are built.
 */
const NAV = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Experts', href: '#experts' },
  { label: 'Verification', href: '#verification' },
  { label: 'Escrow', href: '#escrow' },
  { label: 'Pricing', href: '#pricing' },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = '';
    };
  }, [open]);

  const elevated = scrolled || open;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300',
        elevated
          ? 'border-line/80 bg-white/85 shadow-[0_18px_40px_-32px_rgb(12_39_56/0.45)] backdrop-blur-xl'
          : 'border-transparent bg-white/0',
      )}
    >
      <Container className="flex h-[4.5rem] items-center gap-6">
        <a href="#top" className="rounded-lg" onClick={() => setOpen(false)}>
          <Logo />
          <span className="sr-only">Flyrlink home</span>
        </a>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 hover:bg-canvas-subtle hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-1.5 lg:flex">
          <PreviewActionButton variant="ghost" size="md" message={PREVIEW_MESSAGES.signIn}>
            Sign In
          </PreviewActionButton>
          <ButtonLink href="#describe" size="md" className="pr-4">
            Post a Project
            <ButtonArrow />
          </ButtonLink>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          className="ml-auto grid size-11 cursor-pointer place-items-center rounded-full bg-white text-ink ring-1 ring-line transition-colors hover:ring-line-strong lg:hidden"
        >
          {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
      </Container>

      {open ? (
        <div
          id="mobile-navigation"
          className="h-[calc(100dvh-4.5rem)] overflow-y-auto border-t border-line bg-white lg:hidden"
        >
          <Container className="flex h-full flex-col py-6">
            <nav aria-label="Mobile" className="flex flex-col">
              {NAV.map((item, index) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  style={{ animationDelay: `${index * 40}ms` }}
                  className="flex animate-rise items-center justify-between border-b border-line py-5 text-2xl font-semibold tracking-[-0.02em] text-ink"
                >
                  {item.label}
                  <span aria-hidden="true" className="text-brand-500">
                    →
                  </span>
                </a>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-3 pt-8">
              <ButtonLink href="#describe" size="lg" onClick={() => setOpen(false)}>
                Post a Project
              </ButtonLink>
              <PreviewActionButton variant="secondary" size="lg" message={PREVIEW_MESSAGES.signIn}>
                Sign In
              </PreviewActionButton>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
