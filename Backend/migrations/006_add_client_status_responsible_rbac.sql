-- 1. Новые роли пользователей
ALTER TABLE users
MODIFY role ENUM(
    'ADMIN',
    'MANAGER',
    'TECHNICIAN',
    'SENIOR_TECHNICIAN',
    'ACCOUNTANT',
    'WAREHOUSE_MANAGER',
    'TECH_SUPPORT',
    'ROP'
) NOT NULL;

-- 2. Статус клиента и ответственный менеджер
ALTER TABLE clients
ADD COLUMN status ENUM('ACTIVE', 'BLOCKED', 'DEBTOR') NOT NULL DEFAULT 'ACTIVE' AFTER email,
ADD COLUMN created_by INT NULL AFTER created_at,
ADD COLUMN responsible_manager_id INT NULL AFTER created_by,
ADD COLUMN status_changed_at DATETIME NULL AFTER responsible_manager_id,
ADD COLUMN status_changed_by INT NULL AFTER status_changed_at,
ADD COLUMN responsible_changed_at DATETIME NULL AFTER status_changed_by,
ADD COLUMN responsible_changed_by INT NULL AFTER responsible_changed_at;

-- 3. Индексы для будущих фильтров и прав
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_created_by ON clients(created_by);
CREATE INDEX idx_clients_responsible_manager_id ON clients(responsible_manager_id);

-- 4. Связи с users
ALTER TABLE clients
ADD CONSTRAINT fk_clients_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_clients_responsible_manager_id
    FOREIGN KEY (responsible_manager_id) REFERENCES users(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_clients_status_changed_by
    FOREIGN KEY (status_changed_by) REFERENCES users(id) ON DELETE SET NULL,
ADD CONSTRAINT fk_clients_responsible_changed_by
    FOREIGN KEY (responsible_changed_by) REFERENCES users(id) ON DELETE SET NULL;