-- 028_sms_notifications.sql
-- Additive only (SCHEMA_FREEZE after 014). Audit/log table for every SMS sent
-- through the `send-sms` Supabase Edge Function (Africa's Talking).
--
-- Security model: written exclusively by the `send-sms` Edge Function using
-- the Supabase service-role key, which bypasses RLS. RLS is enabled with NO
-- policies for anon/authenticated roles, so delivery logs (which can contain
-- phone numbers and message bodies) are never reachable via the public
-- Supabase client keys.

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id                 bigserial PRIMARY KEY,
  purpose            text NOT NULL CHECK (purpose IN (
                       'registration',
                       'otp',
                       'login',
                       'password_reset',
                       'subscription_confirmation',
                       'payment_confirmation',
                       'invoice_notification',
                       'custom'
                     )),
  phone              text NOT NULL,
  message            text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('sent', 'failed')),
  provider           text NOT NULL DEFAULT 'africastalking',
  provider_message_id text,
  cost               text,
  error_code         text,
  error_message      text,
  company_id         bigint NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id            uuid NULL,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip                 text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_logs_company_idx ON public.sms_logs (company_id);
CREATE INDEX IF NOT EXISTS sms_logs_purpose_status_idx ON public.sms_logs (purpose, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_logs_phone_idx ON public.sms_logs (phone, created_at DESC);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
-- Intentionally no CREATE POLICY statements: anon/authenticated clients have
-- zero access. Only the service-role key (Edge Function / admin client) can
-- read/write this table.
