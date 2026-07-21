CREATE TABLE vehicle_equipment (
    id INT AUTO_INCREMENT PRIMARY KEY,

    vehicle_id INT NOT NULL,
    warehouse_item_id INT NOT NULL,

    quantity INT NOT NULL DEFAULT 1,

    attached_by INT NULL,
    attached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT NULL,

    is_active TINYINT NOT NULL DEFAULT 1,

    detached_by INT NULL,
    detached_at DATETIME NULL,
    detach_reason TEXT NULL,

    source_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT',

    INDEX idx_vehicle_equipment_vehicle_id (vehicle_id),
    INDEX idx_vehicle_equipment_warehouse_item_id (warehouse_item_id),
    INDEX idx_vehicle_equipment_is_active (is_active),
    INDEX idx_vehicle_equipment_vehicle_active (vehicle_id, is_active),

    CONSTRAINT fk_vehicle_equipment_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_vehicle_equipment_warehouse_item
        FOREIGN KEY (warehouse_item_id) REFERENCES warehouse_items(id),

    CONSTRAINT fk_vehicle_equipment_attached_by
        FOREIGN KEY (attached_by) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_vehicle_equipment_detached_by
        FOREIGN KEY (detached_by) REFERENCES users(id)
        ON DELETE SET NULL
);