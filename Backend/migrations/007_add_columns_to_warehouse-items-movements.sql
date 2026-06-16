ALTER TABLE warehouse_item_movements
ADD COLUMN request_id INT NULL AFTER to_city_id,
ADD COLUMN request_vehicle_id INT NULL AFTER request_id,
ADD COLUMN vehicle_id INT NULL AFTER request_vehicle_id,
ADD COLUMN request_equipment_id INT NULL AFTER vehicle_id,
ADD COLUMN target_user_id INT NULL AFTER request_equipment_id,
ADD COLUMN old_status VARCHAR(50) NULL AFTER quantity,
ADD COLUMN new_status VARCHAR(50) NULL AFTER old_status,
ADD COLUMN old_value TEXT NULL AFTER new_status,
ADD COLUMN new_value TEXT NULL AFTER old_value,
ADD INDEX idx_warehouse_movements_request_id (request_id),
ADD INDEX idx_warehouse_movements_vehicle_id (vehicle_id),
ADD INDEX idx_warehouse_movements_target_user_id (target_user_id),
ADD INDEX idx_warehouse_movements_created_at (created_at);