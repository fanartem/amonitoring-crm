ALTER TABLE warehouse_items
ADD COLUMN assigned_to_user_id INT NULL AFTER city_id,
ADD COLUMN assigned_at DATETIME NULL AFTER assigned_to_user_id,
ADD COLUMN assigned_by INT NULL AFTER assigned_at;

ALTER TABLE warehouse_item_movements
ADD COLUMN from_user_id INT NULL AFTER target_user_id;

CREATE INDEX idx_warehouse_items_assigned_user_status_deleted
ON warehouse_items (assigned_to_user_id, status, is_deleted);

CREATE INDEX idx_warehouse_items_city_status_deleted
ON warehouse_items (city_id, status, is_deleted);

CREATE INDEX idx_warehouse_items_inventory_filters
ON warehouse_items (is_deleted, assigned_to_user_id, city_id, status, category);

CREATE INDEX idx_warehouse_movements_from_user
ON warehouse_item_movements (from_user_id);

CREATE TABLE warehouse_consumable_thresholds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
    category VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    manufacturer VARCHAR(100) NOT NULL DEFAULT '',
    model VARCHAR(100) NOT NULL DEFAULT '',
    threshold_quantity INT NOT NULL DEFAULT 20,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL,
    UNIQUE KEY uniq_consumable_threshold (
        city_id,
        category,
        name,
        manufacturer,
        model
    )
);