/**
 * Home Page showcase — a read-only view of public marketplace data.
 *
 * Returns only what a public expert card would show: display name (first name
 * and last initial), headline, experience, top skills, rating, completed
 * projects and hourly rate — for VERIFIED experts who are accepting work.
 * No email, phone, full name, earnings or anything behind authorization.
 *
 * It never throws. If the database is unreachable, slow or empty, the page falls
 * back to clearly labelled sample content, so a marketing page can never be
 * taken down by a data dependency. The client and the database module are
 * imported lazily for the same reason.
 */

export interface ShowcaseExpert {
  readonly slug: string;
  readonly displayName: string;
  readonly initials: string;
  readonly headline: string;
  readonly yearsOfExperience: number;
  readonly skills: readonly string[];
  /** 0–5, one decimal; null when the expert has no reviews yet. */
  readonly rating: number | null;
  readonly reviewCount: number;
  readonly completedProjects: number;
  /** Minor units as a string (BigInt does not cross the server/client boundary). */
  readonly hourlyRateMinor: string | null;
  readonly currency: string;
  readonly availability: 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'UNAVAILABLE' | 'ON_LEAVE' | string;
}

export interface HomeShowcase {
  /** `live` when read from the platform database. */
  readonly source: 'live' | 'unavailable';
  readonly experts: readonly ShowcaseExpert[];
  readonly stats: {
    readonly verifiedExperts: number;
    readonly categories: number;
    readonly activeServices: number;
  } | null;
}

const UNAVAILABLE: HomeShowcase = { source: 'unavailable', experts: [], stats: null };

/** A marketing page must not wait on a slow database. */
const TIMEOUT_MS = 2_000;

function toDisplayName(fullName: string): { displayName: string; initials: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'Expert';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return {
    displayName: last ? `${first} ${last.charAt(0).toUpperCase()}.` : first,
    initials: `${first.charAt(0)}${last?.charAt(0) ?? ''}`.toUpperCase(),
  };
}

async function readShowcase(limit: number): Promise<HomeShowcase> {
  const { prisma } = await import('../../lib/db/client');

  const publicExpert = {
    verificationStatus: 'VERIFIED',
    isAcceptingWork: true,
    deletedAt: null,
    user: { status: 'ACTIVE', deletedAt: null },
  } as const;

  const experts = await prisma.expertProfile.findMany({
    where: publicExpert,
    orderBy: [{ performance: { avgRating: 'desc' } }, { yearsOfExperience: 'desc' }],
    take: limit,
    select: {
      slug: true,
      headline: true,
      yearsOfExperience: true,
      hourlyRateMinor: true,
      currency: true,
      availabilityStatus: true,
      user: { select: { fullName: true } },
      skills: {
        orderBy: [{ isPrimary: 'desc' }, { yearsOfExperience: 'desc' }],
        take: 4,
        select: { skill: { select: { name: true } } },
      },
      performance: { select: { avgRating: true, reviewCount: true, completedProjects: true } },
    },
  });

  const verifiedExperts = await prisma.expertProfile.count({ where: publicExpert });
  const categories = await prisma.category.count({ where: { isActive: true } });
  const activeServices = await prisma.service.count({ where: { status: 'ACTIVE', deletedAt: null } });

  return {
    source: 'live',
    stats: { verifiedExperts, categories, activeServices },
    experts: experts.map((expert) => {
      const reviewCount = expert.performance?.reviewCount ?? 0;
      return {
        slug: expert.slug,
        ...toDisplayName(expert.user.fullName),
        headline: expert.headline ?? 'Verified expert',
        yearsOfExperience: expert.yearsOfExperience,
        skills: expert.skills.map((link) => link.skill.name),
        // avgRating is stored ×100 (STEP 03).
        rating: reviewCount > 0 && expert.performance ? Math.round(expert.performance.avgRating / 10) / 10 : null,
        reviewCount,
        completedProjects: expert.performance?.completedProjects ?? 0,
        hourlyRateMinor: expert.hourlyRateMinor?.toString() ?? null,
        currency: expert.currency,
        availability: expert.availabilityStatus,
      };
    }),
  };
}

export async function getHomeShowcase(limit = 3): Promise<HomeShowcase> {
  try {
    return await Promise.race([
      readShowcase(limit),
      new Promise<HomeShowcase>((resolve) => setTimeout(() => resolve(UNAVAILABLE), TIMEOUT_MS)),
    ]);
  } catch {
    return UNAVAILABLE;
  }
}
