ALTER TABLE requests
ADD COLUMN created_by INT NULL AFTER total_price;

ALTER TABLE requests
ADD CONSTRAINT fk_requests_created_by
FOREIGN KEY (created_by) REFERENCES users(id)
ON DELETE SET NULL;