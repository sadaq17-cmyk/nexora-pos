-- 022_otp_verifications.sql
-- Additive only (SCHEMA_FREEZE after 014). SMS/Email OTP for registration,
-- login verification, and password reset.
--
-- Security model: this table is written/read exclusively by serverless
-- functions using the Supabase service-role (admin) client, which bypasses
-- RLS. RLS is still enabled with NO policies for anon/authenticated roles,
-- so the OTP codes and hashes are never reachable via the public Supabase
-- client keys even if a code path is misconfigured.

CREATE TABLE IF NOT EXISTS public.otp_verifications (
  id             bigserial PRIMARY KEY,
  purpose        text NOT NULL CHECK (purpose IN ('registration', 'login', 'password_reset')),
  channel        text NOT NULL CHECK (channel IN ('sms', 'email')),
  identifier     text NOT NULL, -- normalized E.164 phone or lowercase email actually used for delivery
  company_id     bigint NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id        uuid NULL,     -- auth.users.id when known (login / password_reset for existing accounts)
  code_hash      text NOT NULL,
  code_salt      text NOT NULL,
  attempts       int NOT NULL DEFAULT 0,
  max_attempts   int NOT NULL DEFAULT 5,
  resend_count   int NOT NULL DEFAULT 0,
  last_sent_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'locked')),
  ip             text,
  fallback_used  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  verified_at    timestamptz
);

-- Fast lookup of the latest OTP row for an identifier+purpose (verify / resend cooldown).
CREATE INDEX IF NOT EXISTS otp_verifications_identifier_purpose_idx
  ON public.otp_verifications (identifier, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS otp_verifications_company_idx
  ON public.otp_verifications (company_id);

-- Housekeeping: cheap filter for cleanup jobs / status queries.
CREATE INDEX IF NOT EXISTS otp_verifications_status_idx
  ON public.otp_verifications (status, expires_at);

ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
-- Intentionally no CREATE POLICY statements: anon/authenticated clients have
-- zero access. Only the service-role key (server-side admin client) can
-- read/write this table.
