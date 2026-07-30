ALTER TABLE vehicles DROP INDEX vin;

ALTER TABLE vehicles
ADD COLUMN active_vin VARCHAR(255)
GENERATED ALWAYS AS (
    CASE
        WHEN is_deleted = 0
             AND vin IS NOT NULL
             AND TRIM(vin) <> ''
        THEN vin
        ELSE NULL
    END
) STORED;

CREATE UNIQUE INDEX uq_vehicles_active_vin
ON vehicles (active_vin);

CREATE INDEX idx_vehicles_vin
ON vehicles (vin);

SHOW INDEX FROM vehicles;

CREATE TABLE vehicle_vin_links (
    id INT AUTO_INCREMENT PRIMARY KEY,

    vin VARCHAR(255) NOT NULL,

    old_vehicle_id INT NOT NULL,
    new_vehicle_id INT NOT NULL,

    old_client_id INT NULL,
    new_client_id INT NULL,

    created_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_vehicle_vin_links_pair (old_vehicle_id, new_vehicle_id),

    INDEX idx_vehicle_vin_links_vin (vin),
    INDEX idx_vehicle_vin_links_old_vehicle_id (old_vehicle_id),
    INDEX idx_vehicle_vin_links_new_vehicle_id (new_vehicle_id),
    INDEX idx_vehicle_vin_links_old_client_id (old_client_id),
    INDEX idx_vehicle_vin_links_new_client_id (new_client_id),

    CONSTRAINT fk_vehicle_vin_links_old_vehicle
        FOREIGN KEY (old_vehicle_id) REFERENCES vehicles(id),

    CONSTRAINT fk_vehicle_vin_links_new_vehicle
        FOREIGN KEY (new_vehicle_id) REFERENCES vehicles(id),

    CONSTRAINT fk_vehicle_vin_links_old_client
        FOREIGN KEY (old_client_id) REFERENCES clients(id),

    CONSTRAINT fk_vehicle_vin_links_new_client
        FOREIGN KEY (new_client_id) REFERENCES clients(id),

    CONSTRAINT fk_vehicle_vin_links_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
);