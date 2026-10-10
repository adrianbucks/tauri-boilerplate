-- Enforce uniqueness for the canonical logical domain across all platform adapters.
-- NULL and blank values remain available for organisations without a domain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_organisations_domain_normalized
  ON core_organisations(lower(trim(domain)))
  WHERE domain IS NOT NULL AND length(trim(domain)) > 0;
