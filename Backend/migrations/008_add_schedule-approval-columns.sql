ALTER TABLE requests
ADD COLUMN schedule_approval_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUIRED' AFTER scheduled_at,
ADD COLUMN schedule_approval_reason TEXT NULL AFTER schedule_approval_status,
ADD COLUMN schedule_approval_requested_by INT NULL AFTER schedule_approval_reason,
ADD COLUMN schedule_approval_requested_at DATETIME NULL AFTER schedule_approval_requested_by,
ADD COLUMN schedule_approval_decided_by INT NULL AFTER schedule_approval_requested_at,
ADD COLUMN schedule_approval_decided_at DATETIME NULL AFTER schedule_approval_decided_by,
ADD COLUMN schedule_approval_comment TEXT NULL AFTER schedule_approval_decided_at;