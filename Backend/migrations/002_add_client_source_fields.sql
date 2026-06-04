ALTER TABLE clients
ADD COLUMN source_system VARCHAR(50) NULL AFTER email,
ADD COLUMN source_client_name VARCHAR(255) NULL AFTER source_system,
ADD COLUMN source_parent_client_name VARCHAR(255) NULL AFTER source_client_name,
ADD COLUMN source_inn VARCHAR(100) NULL AFTER source_parent_client_name;