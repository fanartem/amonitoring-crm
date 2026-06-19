CREATE TABLE vehicle_transfer_history (
    id INT AUTO_INCREMENT PRIMARY KEY,

    vehicle_id INT NOT NULL,

    old_client_id INT NOT NULL,
    new_client_id INT NOT NULL,

    reason TEXT NOT NULL,

    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_vehicle_transfer_vehicle_id (vehicle_id),
    INDEX idx_vehicle_transfer_old_client_id (old_client_id),
    INDEX idx_vehicle_transfer_new_client_id (new_client_id),
    INDEX idx_vehicle_transfer_created_by (created_by)
);

ALTER TABLE vehicles
ADD COLUMN delete_reason_type VARCHAR(50) NULL AFTER deleted_by,
ADD COLUMN delete_reason TEXT NULL AFTER delete_reason_type;