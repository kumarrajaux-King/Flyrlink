/**
 * Icon set.
 *
 * Lucide — the approved icon library (STEP 02 §2) — addressed by semantic keys,
 * so content names what an icon *means* rather than which glyph draws it.
 * Icons are decorative; adjacent text always carries the meaning.
 */

import {
  BadgeCheck,
  BrainCircuit,
  Calculator,
  ChartColumn,
  Cloud,
  CodeXml,
  FileCheck,
  FileText,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  Milestone,
  PenTool,
  Radar,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  UsersRound,
  Wallet,
} from 'lucide-react';

export type IconKey =
  | 'code'
  | 'brain'
  | 'smartphone'
  | 'pen'
  | 'chart'
  | 'cloud'
  | 'trending'
  | 'shield'
  | 'fileText'
  | 'listChecks'
  | 'calculator'
  | 'users'
  | 'target'
  | 'radar'
  | 'badgeCheck'
  | 'fileSignature'
  | 'milestone'
  | 'wallet'
  | 'star'
  | 'sparkles'
  | 'messages';

const ICONS: Readonly<Record<IconKey, LucideIcon>> = {
  code: CodeXml,
  brain: BrainCircuit,
  smartphone: Smartphone,
  pen: PenTool,
  chart: ChartColumn,
  cloud: Cloud,
  trending: TrendingUp,
  shield: ShieldCheck,
  fileText: FileText,
  listChecks: ListChecks,
  calculator: Calculator,
  users: UsersRound,
  target: Target,
  radar: Radar,
  badgeCheck: BadgeCheck,
  fileSignature: FileCheck,
  milestone: Milestone,
  wallet: Wallet,
  star: Star,
  sparkles: Sparkles,
  messages: MessageSquare,
};

export interface IconProps {
  readonly name: IconKey;
  readonly className?: string | undefined;
  readonly strokeWidth?: number | undefined;
}

export function Icon({ name, className, strokeWidth = 1.75 }: IconProps) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" focusable="false" className={className} strokeWidth={strokeWidth} />;
}
