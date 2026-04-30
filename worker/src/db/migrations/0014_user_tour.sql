-- Onboarding tour completion timestamp. NULL means the spotlight
-- overlay tour has not yet run for the user; once they finish or
-- explicitly skip it, the worker writes `unix_seconds()` here so the
-- frontend can decide whether to mount <OnboardingTour /> on next
-- login. We store the timestamp (not a boolean) so we can later
-- replay the tour for users who completed it before a major flow
-- redesign without losing the original completion time.

ALTER TABLE users ADD COLUMN tour_completed_at INTEGER;
