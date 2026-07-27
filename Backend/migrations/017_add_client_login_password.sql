ALTER TABLE clients
ADD COLUMN monitoring_login VARCHAR(255) NULL AFTER email,
ADD COLUMN monitoring_password TEXT NULL AFTER monitoring_login;