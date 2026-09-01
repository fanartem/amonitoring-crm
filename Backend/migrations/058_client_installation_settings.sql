/*
  Этап 1 портала клиента: параметры установки по договору.

  Три таблицы:
  - client_installation_settings — один набор на клиента;
  - client_installation_sensors  — датчики из договора, много на набор;
  - client_history               — общий журнал изменений по клиенту.

  Наличие строки в client_installation_settings означает «параметры настроены».
  Подклиент без своей строки берёт родительские (наследование — в коде).
*/

CREATE TABLE IF NOT EXISTS client_installation_settings (
    id INT NOT NULL AUTO_INCREMENT,
    client_id INT NOT NULL,

    -- Параметры любой заявки клиента
    visit_type VARCHAR(16) NULL,          -- IN_OFFICE / ON_SITE
    visit_price_code VARCHAR(50) NULL,    -- ON_SITE_CITY / ON_SITE_OUTSIDE_CITY
    platform VARCHAR(100) NULL,

    -- Параметры установки
    gps_price_code VARCHAR(50) NULL,      -- NULL = без GPS, только маяк
    tracker_subscription_months INT NOT NULL DEFAULT 0,
    has_blocking TINYINT(1) NOT NULL DEFAULT 0,
    has_beacon TINYINT(1) NOT NULL DEFAULT 0,
    beacon_subscription_months INT NOT NULL DEFAULT 0,

    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_client_installation_settings_client (client_id),
    CONSTRAINT fk_client_installation_settings_client
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_installation_sensors (
    id INT NOT NULL AUTO_INCREMENT,
    settings_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,

    PRIMARY KEY (id),
    KEY idx_client_installation_sensors_settings (settings_id),
    CONSTRAINT fk_client_installation_sensors_settings
        FOREIGN KEY (settings_id) REFERENCES client_installation_settings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id INT NOT NULL,
    user_id INT NULL,
    action VARCHAR(64) NOT NULL,
    field_name VARCHAR(64) NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    comment VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_client_history_client (client_id, created_at),
    KEY idx_client_history_action (action),
    CONSTRAINT fk_client_history_client
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    CONSTRAINT fk_client_history_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Права
INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('clients.installation_settings.view',
 'Просмотр параметров установки клиента',
 'Позволяет видеть параметры установки, заданные договором с клиентом.',
 'CLIENTS', 1, 760),

('clients.installation_settings.manage_all',
 'Изменение параметров установки любого клиента',
 'Позволяет менять параметры установки у всех клиентов.',
 'CLIENTS', 1, 761),

('clients.installation_settings.manage_own',
 'Изменение параметров установки своих клиентов',
 'Позволяет менять параметры установки у клиентов, за которых пользователь отвечает.',
 'CLIENTS', 1, 762),

('clients.history.view',
 'История изменений клиента',
 'Позволяет видеть журнал изменений по клиенту: данные, статус, тип оплаты, ответственный, параметры установки.',
 'CLIENTS', 1, 763)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

-- Зависимости. Направление: широкое право тянет узкое, действие тянет базовый просмотр.
INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM (
    SELECT 'clients.installation_settings.manage_all' AS permission_code, 'clients.installation_settings.view' AS required_code UNION ALL
    SELECT 'clients.installation_settings.manage_own', 'clients.installation_settings.view' UNION ALL
    SELECT 'clients.installation_settings.view', 'clients.view' UNION ALL
    SELECT 'clients.history.view', 'clients.view'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions req ON req.code = dep.required_code;

-- Выдача ролям
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'clients.installation_settings.view' AS permission_code UNION ALL
    SELECT 'ROP', 'clients.installation_settings.view' UNION ALL
    SELECT 'MANAGER', 'clients.installation_settings.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'clients.installation_settings.view' UNION ALL

    SELECT 'ADMIN', 'clients.installation_settings.manage_all' UNION ALL
    SELECT 'ROP', 'clients.installation_settings.manage_all' UNION ALL

    SELECT 'MANAGER', 'clients.installation_settings.manage_own' UNION ALL

    SELECT 'ADMIN', 'clients.history.view' UNION ALL
    SELECT 'ROP', 'clients.history.view' UNION ALL
    SELECT 'MANAGER', 'clients.history.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'clients.history.view'
) grants
INNER JOIN roles r ON r.code = grants.role_code
INNER JOIN permissions p ON p.code = grants.permission_code;