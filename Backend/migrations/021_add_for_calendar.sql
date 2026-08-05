ALTER TABLE requests
ADD COLUMN scheduled_duration_minutes INT NOT NULL DEFAULT 60 AFTER scheduled_at;

CREATE INDEX idx_requests_calendar_range
ON requests (scheduled_at, status, is_deleted);