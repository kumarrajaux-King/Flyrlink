-- CHECK constraints — STEP 3 final hardening (D-05).
--
-- Prisma cannot express CHECK constraints in schema.prisma, so they are added
-- here as raw SQL. Prisma's migration runner applies and preserves them; they
-- are simply invisible to the Prisma schema.
--
-- DESIGN PRINCIPLE
--   Only invariants that are true at EVERY point in a legitimate lifecycle are
--   enforced here. Anything that could make a valid future workflow state
--   impossible is deliberately left to the service layer and documented.
--
--   Specifically: these constraints reject *contradictory* data (a field set
--   that the row's own source/type says must not be set) and *arithmetic
--   violations* (a commission that does not add up). They never require a
--   relationship to exist yet, because the workflow legitimately creates a
--   project before every link is populated.

-- ============================================================================
-- PROJECTS — source ↔ relationship consistency (A-01 semantics)
-- ============================================================================

-- A service link is meaningful ONLY for the PREDEFINED_SERVICE entry flow.
-- Negative form: never requires serviceId to be present, so a draft or an
-- in-progress catalog purchase is never blocked.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_service_link_matches_source"
  CHECK ("source" = 'PREDEFINED_SERVICE' OR "serviceId" IS NULL);

-- An invited-expert link is meaningful ONLY for the DIRECT_HIRE entry flow.
-- POSTED_PROJECT invitations are represented by Assignment, not this column.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_invited_expert_matches_source"
  CHECK ("source" = 'DIRECT_HIRE' OR "invitedExpertId" IS NULL);

-- Budget and estimate ranges must be coherent when both bounds are given.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_budget_range_coherent"
  CHECK (
    "budgetMinMinor" IS NULL OR "budgetMaxMinor" IS NULL
    OR "budgetMinMinor" <= "budgetMaxMinor"
  );

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_estimated_budget_range_coherent"
  CHECK (
    "estimatedBudgetMinMinor" IS NULL OR "estimatedBudgetMaxMinor" IS NULL
    OR "estimatedBudgetMinMinor" <= "estimatedBudgetMaxMinor"
  );

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_amounts_non_negative"
  CHECK (
    ("budgetMinMinor" IS NULL OR "budgetMinMinor" >= 0)
    AND ("budgetMaxMinor" IS NULL OR "budgetMaxMinor" >= 0)
    AND ("estimatedBudgetMinMinor" IS NULL OR "estimatedBudgetMinMinor" >= 0)
    AND ("estimatedBudgetMaxMinor" IS NULL OR "estimatedBudgetMaxMinor" >= 0)
  );

-- ============================================================================
-- FINANCIAL ARITHMETIC — the identities that must always hold
-- ============================================================================

-- Commission must account for the whole gross amount, exactly.
ALTER TABLE "commissions"
  ADD CONSTRAINT "commissions_gross_equals_commission_plus_payable"
  CHECK ("grossAmountMinor" = "commissionAmountMinor" + "expertPayableMinor");

ALTER TABLE "commissions"
  ADD CONSTRAINT "commissions_amounts_non_negative"
  CHECK (
    "grossAmountMinor" >= 0
    AND "commissionAmountMinor" >= 0
    AND "expertPayableMinor" >= 0
  );

-- Payout net must equal gross less commission, exactly.
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_net_equals_gross_minus_commission"
  CHECK ("netAmountMinor" = "grossAmountMinor" - "commissionAmountMinor");

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amounts_non_negative"
  CHECK (
    "grossAmountMinor" >= 0
    AND "commissionAmountMinor" >= 0
    AND "netAmountMinor" >= 0
  );

-- Order total must equal subtotal plus tax, exactly.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_equals_subtotal_plus_tax"
  CHECK ("totalMinor" = "subtotalMinor" + "taxMinor");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
  CHECK ("subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0);

-- A payment must be for a positive amount, and can never be over-refunded.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refund_within_amount"
  CHECK ("refundedAmountMinor" >= 0 AND "refundedAmountMinor" <= "amountMinor");

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_amount_non_negative"
  CHECK ("amountMinor" >= 0);

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_amounts_non_negative"
  CHECK (
    "totalValueMinor" >= 0
    AND ("hourlyRateMinor" IS NULL OR "hourlyRateMinor" >= 0)
  );

ALTER TABLE "contract_versions"
  ADD CONSTRAINT "contract_versions_amount_non_negative"
  CHECK ("totalValueMinor" >= 0);

ALTER TABLE "payout_items"
  ADD CONSTRAINT "payout_items_amount_non_negative"
  CHECK ("amountMinor" >= 0);

-- Ledger direction is carried by entryType, never by a negative amount.
-- Keeping magnitudes strictly positive is what makes the debit/credit
-- balance check meaningful.
ALTER TABLE "transaction_ledger"
  ADD CONSTRAINT "ledger_amount_positive"
  CHECK ("amountMinor" > 0);

-- A transaction can never be its own reversal.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_reversal_not_self"
  CHECK ("reversalOfId" IS NULL OR "reversalOfId" <> "id");

-- ============================================================================
-- CURRENCY — ISO-4217 shape on the financially critical tables
-- ============================================================================

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "transaction_ledger"
  ADD CONSTRAINT "ledger_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "commissions"
  ADD CONSTRAINT "commissions_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ============================================================================
-- COMMISSION RULES — a rule must carry the values its own type requires
-- ============================================================================

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_percentage_requires_basis_points"
  CHECK (
    "calculationType" <> 'PERCENTAGE'
    OR ("percentageBasisPoints" IS NOT NULL AND "percentageBasisPoints" BETWEEN 0 AND 10000)
  );

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_fixed_requires_amount"
  CHECK (
    "calculationType" <> 'FIXED'
    OR ("fixedAmountMinor" IS NOT NULL AND "fixedAmountMinor" >= 0)
  );

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_effective_window_coherent"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_value_window_coherent"
  CHECK (
    "minProjectValueMinor" IS NULL OR "maxProjectValueMinor" IS NULL
    OR "minProjectValueMinor" <= "maxProjectValueMinor"
  );

-- ============================================================================
-- REPUTATION — self-review is impossible at the database level
-- ============================================================================

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_no_self_review"
  CHECK ("reviewerUserId" <> "revieweeUserId");

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_overall_rating_range"
  CHECK ("overallRating" BETWEEN 1 AND 5);

ALTER TABLE "ratings"
  ADD CONSTRAINT "ratings_score_range"
  CHECK ("score" BETWEEN 1 AND 5);

-- ============================================================================
-- SCORES — basis points stay in range, so a score can never exceed 100%
-- ============================================================================

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_scores_in_basis_points"
  CHECK (
    "overallScore" BETWEEN 0 AND 10000
    AND ("skillScore" IS NULL OR "skillScore" BETWEEN 0 AND 10000)
    AND ("experienceScore" IS NULL OR "experienceScore" BETWEEN 0 AND 10000)
    AND ("similarProjectScore" IS NULL OR "similarProjectScore" BETWEEN 0 AND 10000)
    AND ("availabilityScore" IS NULL OR "availabilityScore" BETWEEN 0 AND 10000)
    AND ("budgetFitScore" IS NULL OR "budgetFitScore" BETWEEN 0 AND 10000)
    AND ("ratingScore" IS NULL OR "ratingScore" BETWEEN 0 AND 10000)
    AND ("pastPerformanceScore" IS NULL OR "pastPerformanceScore" BETWEEN 0 AND 10000)
    AND ("onTimePerformanceScore" IS NULL OR "onTimePerformanceScore" BETWEEN 0 AND 10000)
    AND ("clientSatisfactionScore" IS NULL OR "clientSatisfactionScore" BETWEEN 0 AND 10000)
    AND ("responseTimeScore" IS NULL OR "responseTimeScore" BETWEEN 0 AND 10000)
    AND ("certificationScore" IS NULL OR "certificationScore" BETWEEN 0 AND 10000)
  );

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_rank_positive"
  CHECK ("rank" >= 1);

-- A recommendation targets an expert or a team, never both at once.
ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_not_both_expert_and_team"
  CHECK (NOT ("expertId" IS NOT NULL AND "teamId" IS NOT NULL));

ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_not_both_expert_and_team"
  CHECK (NOT ("expertId" IS NOT NULL AND "teamId" IS NOT NULL));

ALTER TABLE "expert_performance"
  ADD CONSTRAINT "expert_performance_rates_in_basis_points"
  CHECK (
    "onTimeDeliveryRate" BETWEEN 0 AND 10000
    AND "revisionRate" BETWEEN 0 AND 10000
    AND "cancellationRate" BETWEEN 0 AND 10000
    AND "disputeRate" BETWEEN 0 AND 10000
    AND "repeatClientRate" BETWEEN 0 AND 10000
    AND "clientSatisfaction" BETWEEN 0 AND 10000
  );

-- avgRating is a 1..5 rating scaled by 100 (480 = 4.80).
ALTER TABLE "expert_performance"
  ADD CONSTRAINT "expert_performance_avg_rating_range"
  CHECK ("avgRating" BETWEEN 0 AND 500);

ALTER TABLE "expert_performance"
  ADD CONSTRAINT "expert_performance_counts_non_negative"
  CHECK (
    "completedProjects" >= 0
    AND "reviewCount" >= 0
    AND "totalEarnedMinor" >= 0
    AND ("avgResponseMinutes" IS NULL OR "avgResponseMinutes" >= 0)
  );

-- ============================================================================
-- TALENT — profile and pricing sanity
-- ============================================================================

ALTER TABLE "expert_profiles"
  ADD CONSTRAINT "expert_profiles_completeness_percent"
  CHECK ("profileCompleteness" BETWEEN 0 AND 100);

ALTER TABLE "expert_profiles"
  ADD CONSTRAINT "expert_profiles_rate_and_experience_non_negative"
  CHECK (
    ("hourlyRateMinor" IS NULL OR "hourlyRateMinor" >= 0)
    AND "yearsOfExperience" >= 0
    AND ("weeklyCapacityHours" IS NULL OR "weeklyCapacityHours" BETWEEN 0 AND 168)
  );

ALTER TABLE "expert_skills"
  ADD CONSTRAINT "expert_skills_years_non_negative"
  CHECK ("yearsOfExperience" >= 0);

ALTER TABLE "services"
  ADD CONSTRAINT "services_pricing_sane"
  CHECK ("basePriceMinor" >= 0 AND "deliveryDays" > 0 AND "revisionsIncluded" >= 0);

ALTER TABLE "service_packages"
  ADD CONSTRAINT "service_packages_pricing_sane"
  CHECK ("priceMinor" >= 0 AND "deliveryDays" > 0 AND "revisions" >= 0);

ALTER TABLE "certifications"
  ADD CONSTRAINT "certifications_expiry_after_issue"
  CHECK ("expiryDate" IS NULL OR "issueDate" IS NULL OR "expiryDate" > "issueDate");

-- ============================================================================
-- AVAILABILITY — minute-of-day windows must be real windows
-- ============================================================================

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_day_of_week_range"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6);

ALTER TABLE "availability"
  ADD CONSTRAINT "availability_minute_window_valid"
  CHECK (
    "startMinute" >= 0 AND "startMinute" < 1440
    AND "endMinute" > 0 AND "endMinute" <= 1440
    AND "startMinute" < "endMinute"
  );

ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "availability_exceptions_minute_window_valid"
  CHECK (
    ("startMinute" IS NULL AND "endMinute" IS NULL)
    OR (
      "startMinute" >= 0 AND "startMinute" < 1440
      AND "endMinute" > 0 AND "endMinute" <= 1440
      AND "startMinute" < "endMinute"
    )
  );

-- ============================================================================
-- EXECUTION — time entries and task hierarchy
-- ============================================================================

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_duration_positive"
  CHECK ("durationMinutes" > 0);

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_end_after_start"
  CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_rate_non_negative"
  CHECK ("ratePerHourMinor" >= 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parent_not_self"
  CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_estimated_hours_non_negative"
  CHECK ("estimatedHours" IS NULL OR "estimatedHours" >= 0);

ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_revision_count_non_negative"
  CHECK ("revisionCount" >= 0);

ALTER TABLE "deliverables"
  ADD CONSTRAINT "deliverables_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_allocation_percent_range"
  CHECK ("allocationPercent" BETWEEN 1 AND 100);

-- ============================================================================
-- HIERARCHIES — no self-parenting
-- ============================================================================

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_not_self"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_parent_not_self"
  CHECK ("parentMessageId" IS NULL OR "parentMessageId" <> "id");

-- ============================================================================
-- DISPUTES — award amounts are non-negative
-- ============================================================================

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_amounts_non_negative"
  CHECK (
    ("disputedAmountMinor" IS NULL OR "disputedAmountMinor" >= 0)
    AND ("customerAwardMinor" IS NULL OR "customerAwardMinor" >= 0)
    AND ("expertAwardMinor" IS NULL OR "expertAwardMinor" >= 0)
  );

-- ============================================================================
-- AI — cost and token accounting cannot go negative
-- ============================================================================

ALTER TABLE "ai_runs"
  ADD CONSTRAINT "ai_runs_usage_non_negative"
  CHECK (
    ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0)
    AND ("costMinor" IS NULL OR "costMinor" >= 0)
    AND "retryCount" >= 0
  );

-- A HIGH or CRITICAL risk action can never be recorded as auto-approved.
-- This is the human-in-the-loop guarantee, enforced by the database.
ALTER TABLE "ai_actions"
  ADD CONSTRAINT "ai_actions_high_risk_never_auto_approved"
  CHECK ("riskTier" NOT IN ('HIGH', 'CRITICAL') OR "status" <> 'AUTO_APPROVED');

-- An executed HIGH/CRITICAL action must name the human who approved it.
ALTER TABLE "ai_actions"
  ADD CONSTRAINT "ai_actions_high_risk_execution_requires_approver"
  CHECK (
    "riskTier" NOT IN ('HIGH', 'CRITICAL')
    OR "status" <> 'EXECUTED'
    OR "approvedByUserId" IS NOT NULL
  );

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_attempts_non_negative"
  CHECK ("attempts" >= 0);
