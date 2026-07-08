-- ============================================================
-- Migration: add BIN/IIN field to clients
-- Date: 2026-07
--
-- Purpose:
--   Add client identifier field:
--   - For TOO/IP: BIN is required in create/edit API.
--   - For individuals: IIN is optional.
--   - Existing TOO/IP clients get placeholder "Необходимо добавить".
-- ============================================================

ALTER TABLE clients
ADD COLUMN bin_iin VARCHAR(32) NULL AFTER type;

UPDATE clients
SET bin_iin = 'Необходимо добавить'
WHERE type != 'INDIVIDUAL'
  AND (
      bin_iin IS NULL
      OR TRIM(bin_iin) = ''
  );
