-- ============================================================
-- Migration: add request executors
-- Date: 2026-07
--
-- Purpose:
--   Allow one request to have multiple executors.
--   requests.assigned_to remains as the main/first executor
--   for backward compatibility with existing logic.
-- ============================================================

CREATE TABLE request_executors (
    id INT AUTO_INCREMENT PRIMARY KEY,

    request_id INT NOT NULL,
    user_id INT NOT NULL,

    assigned_by INT NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_request_executor (request_id, user_id),

    INDEX idx_request_executors_request_id (request_id),
    INDEX idx_request_executors_user_id (user_id),
    INDEX idx_request_executors_assigned_by (assigned_by),

    CONSTRAINT fk_request_executors_request
        FOREIGN KEY (request_id) REFERENCES requests(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_request_executors_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_request_executors_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id)
        ON DELETE CASCADE
);

INSERT INTO request_executors (
    request_id,
    user_id,
    assigned_by,
    assigned_at
)
SELECT
    r.id,
    r.assigned_to,
    COALESCE(r.created_by, r.assigned_to),
    COALESCE(r.created_at, NOW())
FROM requests r
WHERE r.assigned_to IS NOT NULL
  AND r.is_deleted = 0
  AND NOT EXISTS (
      SELECT 1
      FROM request_executors re
      WHERE re.request_id = r.id
        AND re.user_id = r.assigned_to
  );