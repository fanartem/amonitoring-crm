ALTER TABLE warehouse_items
ADD COLUMN returnable_on_removal TINYINT(1)
GENERATED ALWAYS AS (
    CASE
        WHEN category = 'RELAY' THEN 1
        ELSE 0
    END
) STORED AFTER condition_status;

CREATE INDEX idx_warehouse_items_returnable_on_removal
ON warehouse_items (returnable_on_removal);