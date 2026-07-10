-- ============================================================
-- Migration: add payment type to clients
-- Date: 2026-07
--
-- Purpose:
--   Add client payment type:
--   - PREPAYMENT: requests are visible to technicians only after payment.
--   - POSTPAYMENT: requests are visible to technicians immediately after creation.
-- ============================================================

ALTER TABLE clients
ADD COLUMN payment_type ENUM('PREPAYMENT', 'POSTPAYMENT') NOT NULL DEFAULT 'PREPAYMENT' AFTER status;