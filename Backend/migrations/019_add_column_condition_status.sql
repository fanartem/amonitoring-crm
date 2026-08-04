ALTER TABLE warehouse_items
ADD COLUMN condition_status VARCHAR(20) NOT NULL DEFAULT 'NEW' AFTER status;

CREATE INDEX idx_warehouse_items_condition_status
ON warehouse_items (condition_status);

ALTER TABLE warehouse_items
ADD COLUMN active_identifier_value VARCHAR(255)
GENERATED ALWAYS AS (
    CASE
        WHEN is_deleted = 0
             AND identifier_value IS NOT NULL
             AND TRIM(identifier_value) <> ''
        THEN identifier_value
        ELSE NULL
    END
) STORED;

ALTER TABLE warehouse_items DROP INDEX uq_warehouse_identifier;

CREATE UNIQUE INDEX uq_warehouse_active_identifier
ON warehouse_items (identifier_type, active_identifier_value);