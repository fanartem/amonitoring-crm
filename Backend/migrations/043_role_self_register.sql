ALTER TABLE roles
    ADD COLUMN can_self_register TINYINT(1) NOT NULL DEFAULT 0
    AFTER can_be_responsible_manager;

-- Роли, которые имеет смысл выбирать при самостоятельной регистрации.
UPDATE roles
SET can_self_register = 1
WHERE code IN (
    'MANAGER',
    'TECH_SUPPORT',
    'ACCOUNTANT',
    'WAREHOUSE_MANAGER',
    'SENIOR_TECHNICIAN',
    'TECHNICIAN'
);