-- 025_add_access_control.sql
-- Система ролей, доступов, супер-админов и audit log.
-- Выдаем супер-админские права пользователю с id = 1 (Main Admin).

SET @OWNER_USER_ID = 1;

START TRANSACTION;

-- 1. Роли

CREATE TABLE IF NOT EXISTS roles (
    id INT NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    badge_color CHAR(7) NOT NULL DEFAULT '#64748B',

    data_scope ENUM(
        'ALL',
        'CITY',
        'RESPONSIBLE_CLIENTS',
        'ASSIGNED',
        'CITY_ASSIGNED',
        'OWN',
        'NONE'
    ) NOT NULL DEFAULT 'NONE',

    is_system TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,

    can_be_request_executor TINYINT(1) NOT NULL DEFAULT 0,
    can_be_responsible_manager TINYINT(1) NOT NULL DEFAULT 0,

    sort_order INT NOT NULL DEFAULT 100,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    created_by INT NULL,
    updated_by INT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_code (code),
    KEY idx_roles_active (is_active),
    KEY idx_roles_system (is_system),
    KEY idx_roles_sort_order (sort_order),

    CONSTRAINT chk_roles_code_format
        CHECK (code REGEXP '^[A-Z0-9_]{2,50}$'),

    CONSTRAINT chk_roles_badge_color
        CHECK (badge_color REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 2. Permissions

CREATE TABLE IF NOT EXISTS permissions (
    id INT NOT NULL AUTO_INCREMENT,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(255) NULL,
    category VARCHAR(50) NOT NULL,

    is_dangerous TINYINT(1) NOT NULL DEFAULT 0,
    is_system TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,

    sort_order INT NOT NULL DEFAULT 100,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_permissions_code (code),
    KEY idx_permissions_category (category),
    KEY idx_permissions_active (is_active),
    KEY idx_permissions_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 3. Стандартные permissions роли

CREATE TABLE IF NOT EXISTS role_permissions (
    id INT NOT NULL AUTO_INCREMENT,
    role_id INT NOT NULL,
    permission_id INT NOT NULL,

    is_locked_core TINYINT(1) NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_role_permissions_role_permission (role_id, permission_id),
    KEY idx_role_permissions_role (role_id),
    KEY idx_role_permissions_permission (permission_id),

    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 4. Зависимости permissions

CREATE TABLE IF NOT EXISTS permission_dependencies (
    id INT NOT NULL AUTO_INCREMENT,
    permission_id INT NOT NULL,
    required_permission_id INT NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_permission_dependencies_pair (permission_id, required_permission_id),
    KEY idx_permission_dependencies_permission (permission_id),
    KEY idx_permission_dependencies_required (required_permission_id),

    CONSTRAINT fk_permission_dependencies_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_permission_dependencies_required_permission
        FOREIGN KEY (required_permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 5. Индивидуальные overrides пользователя

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    permission_id INT NOT NULL,

    effect ENUM('ALLOW', 'DENY') NOT NULL,
    reason VARCHAR(255) NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    created_by INT NULL,
    updated_by INT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_permission_overrides_user_permission (user_id, permission_id),
    KEY idx_user_permission_overrides_user (user_id),
    KEY idx_user_permission_overrides_permission (permission_id),
    KEY idx_user_permission_overrides_effect (effect),

    CONSTRAINT fk_user_permission_overrides_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_permission_overrides_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_permission_overrides_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_user_permission_overrides_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 6. Security flags пользователя

CREATE TABLE IF NOT EXISTS user_security_flags (
    user_id INT NOT NULL,

    is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
    is_owner TINYINT(1) NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    updated_by INT NULL,

    PRIMARY KEY (user_id),

    CONSTRAINT fk_user_security_flags_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_security_flags_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 7. Audit log

CREATE TABLE IF NOT EXISTS access_audit_log (
    id INT NOT NULL AUTO_INCREMENT,

    actor_user_id INT NULL,
    target_user_id INT NULL,
    target_role_id INT NULL,

    action VARCHAR(100) NOT NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    reason VARCHAR(255) NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_access_audit_actor (actor_user_id),
    KEY idx_access_audit_target_user (target_user_id),
    KEY idx_access_audit_target_role (target_role_id),
    KEY idx_access_audit_action (action),
    KEY idx_access_audit_created_at (created_at),

    CONSTRAINT fk_access_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_access_audit_target_user
        FOREIGN KEY (target_user_id) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_access_audit_target_role
        FOREIGN KEY (target_role_id) REFERENCES roles(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 8. Seed системных ролей

INSERT INTO roles (
    code,
    name,
    description,
    badge_color,
    data_scope,
    is_system,
    is_active,
    can_be_request_executor,
    can_be_responsible_manager,
    sort_order
)
VALUES
    ('ADMIN', 'Админ', 'Системная роль администратора', '#DC2626', 'ALL', 1, 1, 0, 1, 10),
    ('ROP', 'РОП', 'Руководитель отдела продаж', '#EA580C', 'ALL', 1, 1, 0, 1, 20),
    ('MANAGER', 'Менеджер', 'Менеджер по клиентам', '#2563EB', 'RESPONSIBLE_CLIENTS', 1, 1, 0, 1, 30),
    ('TECH_SUPPORT', 'Тех. поддержка', 'Сотрудник технической поддержки', '#0891B2', 'ALL', 1, 1, 0, 0, 40),
    ('ACCOUNTANT', 'Бухгалтер', 'Бухгалтерия и оплата', '#7C3AED', 'ALL', 1, 1, 0, 0, 50),
    ('WAREHOUSE_MANAGER', 'Зав. складом', 'Управление складом', '#16A34A', 'ALL', 1, 1, 0, 0, 60),
    ('SENIOR_TECHNICIAN', 'Старший монтажник', 'Старший монтажник / распределение заявок', '#CA8A04', 'ALL', 1, 1, 1, 0, 70),
    ('TECHNICIAN', 'Монтажник', 'Монтажник', '#64748B', 'CITY_ASSIGNED', 1, 1, 1, 0, 80)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    badge_color = VALUES(badge_color),
    data_scope = VALUES(data_scope),
    is_system = VALUES(is_system),
    is_active = VALUES(is_active),
    can_be_request_executor = VALUES(can_be_request_executor),
    can_be_responsible_manager = VALUES(can_be_responsible_manager),
    sort_order = VALUES(sort_order);


-- 9. Перевод users.role из ENUM в VARCHAR

ALTER TABLE users
    MODIFY role VARCHAR(50) NOT NULL;

ALTER TABLE users
    ADD INDEX idx_users_role (role);

ALTER TABLE users
    ADD CONSTRAINT fk_users_role_code
    FOREIGN KEY (role) REFERENCES roles(code)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;


-- 10. Seed permissions

INSERT INTO permissions (
    code,
    name,
    description,
    category,
    is_dangerous,
    is_system,
    is_active,
    sort_order
)
VALUES
    -- Заявки
    ('requests.view', 'Просмотр заявок', 'Базовый доступ к разделу заявок с учётом data_scope', 'requests', 0, 1, 1, 10),
    ('requests.view_all', 'Просмотр всех заявок', 'Просмотр всех заявок без ограничения по ответственному/городу', 'requests', 1, 1, 1, 20),
    ('requests.create', 'Создание заявок', 'Создание новых заявок', 'requests', 0, 1, 1, 30),
    ('requests.edit_all', 'Редактирование всех заявок', 'Редактирование любой заявки', 'requests', 1, 1, 1, 40),
    ('requests.edit_own', 'Редактирование своих заявок', 'Редактирование заявок в рамках своей области доступа', 'requests', 0, 1, 1, 50),
    ('requests.payment.manage', 'Управление оплатой заявки', 'Изменение признака оплаты и финансовых полей заявки', 'requests', 1, 1, 1, 60),
    ('requests.status.change', 'Изменение статуса заявки', 'Изменение статуса заявки', 'requests', 0, 1, 1, 70),
    ('requests.delete_any', 'Удаление любой заявки', 'Удаление любой заявки', 'requests', 1, 1, 1, 80),
    ('requests.delete_own_limited', 'Удаление своей заявки в лимит времени', 'Удаление своей новой заявки в течение ограниченного времени', 'requests', 0, 1, 1, 90),
    ('requests.executors.manage', 'Назначение исполнителей', 'Назначение и изменение исполнителей заявки', 'requests', 0, 1, 1, 100),
    ('requests.complete_own', 'Завершение своей заявки', 'Завершение заявки назначенным исполнителем', 'requests', 0, 1, 1, 110),
    ('requests.complete_any', 'Завершение любой заявки', 'Завершение заявки старшим сотрудником', 'requests', 1, 1, 1, 120),
    ('requests.comments.create', 'Комментарии к заявкам', 'Добавление комментариев к заявкам', 'requests', 0, 1, 1, 130),

    -- Клиенты
    ('clients.view', 'Просмотр клиентов', 'Базовый доступ к разделу клиентов', 'clients', 0, 1, 1, 10),
    ('clients.view_all', 'Просмотр всех клиентов', 'Просмотр всех клиентов без ограничения по ответственному', 'clients', 1, 1, 1, 20),
    ('clients.create', 'Создание клиентов', 'Создание новых клиентов', 'clients', 0, 1, 1, 30),
    ('clients.edit_all', 'Редактирование всех клиентов', 'Редактирование любого клиента', 'clients', 1, 1, 1, 40),
    ('clients.edit_own', 'Редактирование своих клиентов', 'Редактирование клиентов, где пользователь создатель или ответственный', 'clients', 0, 1, 1, 50),
    ('clients.status.change', 'Изменение статуса клиента', 'Изменение статуса клиента', 'clients', 1, 1, 1, 60),
    ('clients.responsible.reassign', 'Переназначение ответственного менеджера', 'Изменение ответственного менеджера клиента', 'clients', 1, 1, 1, 70),
    ('clients.delete', 'Удаление клиентов', 'Перемещение клиентов в корзину', 'clients', 1, 1, 1, 80),
    ('clients.restore', 'Восстановление клиентов', 'Восстановление клиентов из корзины', 'clients', 1, 1, 1, 90),

    -- Автомобили
    ('vehicles.view', 'Просмотр автомобилей', 'Просмотр автомобилей клиентов', 'vehicles', 0, 1, 1, 10),
    ('vehicles.create', 'Создание автомобилей', 'Создание автомобилей клиента', 'vehicles', 0, 1, 1, 20),
    ('vehicles.edit', 'Редактирование автомобилей', 'Редактирование автомобилей клиента', 'vehicles', 0, 1, 1, 30),
    ('vehicles.delete', 'Удаление автомобилей', 'Удаление автомобилей клиента', 'vehicles', 1, 1, 1, 40),
    ('vehicles.import', 'Импорт автомобилей', 'Импорт автомобилей из Excel', 'vehicles', 0, 1, 1, 50),

    -- Цены
    ('prices.view', 'Просмотр цен', 'Просмотр цен и расчётов', 'prices', 0, 1, 1, 10),
    ('prices.base.manage', 'Управление базовыми ценами', 'Создание и изменение базовых цен', 'prices', 1, 1, 1, 20),
    ('prices.client.manage_all', 'Управление ценами всех клиентов', 'Изменение индивидуальных цен любого клиента', 'prices', 1, 1, 1, 30),
    ('prices.client.manage_own', 'Управление ценами своих клиентов', 'Изменение индивидуальных цен своих клиентов', 'prices', 0, 1, 1, 40),

    -- Склад
    ('warehouse.view', 'Просмотр склада', 'Просмотр складских остатков', 'warehouse', 0, 1, 1, 10),
    ('warehouse.manage', 'Управление складом', 'Создание, изменение, перемещение и списание оборудования', 'warehouse', 1, 1, 1, 20),
    ('warehouse.inventory.view', 'Просмотр оборудования у сотрудников', 'Просмотр оборудования, выданного пользователям', 'warehouse', 0, 1, 1, 30),
    ('warehouse.inventory.manage', 'Управление оборудованием у сотрудников', 'Выдача, возврат и перемещение оборудования сотрудников', 'warehouse', 1, 1, 1, 40),

    -- Сотрудники
    ('employees.view', 'Просмотр сотрудников', 'Просмотр списка сотрудников', 'employees', 0, 1, 1, 10),
    ('employees.manage', 'Управление сотрудниками', 'Редактирование сотрудников', 'employees', 1, 1, 1, 20),
    ('employees.approve', 'Одобрение сотрудников', 'Одобрение новых регистраций', 'employees', 1, 1, 1, 30),
    ('employees.delete', 'Удаление сотрудников', 'Отключение сотрудников', 'employees', 1, 1, 1, 40),
    ('employees.roles.change', 'Изменение роли сотрудника', 'Назначение роли пользователю', 'employees', 1, 1, 1, 50),
    ('employees.permissions.manage', 'Индивидуальные доступы сотрудников', 'Изменение индивидуальных доступов пользователя', 'employees', 1, 1, 1, 60),

    -- Роли и доступы
    ('roles.view', 'Просмотр ролей', 'Просмотр ролей и стандартных доступов', 'roles', 0, 1, 1, 10),
    ('roles.manage', 'Управление ролями', 'Общий доступ к управлению ролями', 'roles', 1, 1, 1, 20),
    ('roles.create', 'Создание ролей', 'Создание новых пользовательских ролей', 'roles', 1, 1, 1, 30),
    ('roles.edit', 'Редактирование ролей', 'Изменение названия, цвета, описания и стандартных доступов роли', 'roles', 1, 1, 1, 40),
    ('roles.delete_custom', 'Удаление пользовательских ролей', 'Удаление не системных ролей', 'roles', 1, 1, 1, 50),

    -- Настройки
    ('settings.view', 'Просмотр настроек', 'Просмотр системных настроек CRM', 'settings', 0, 1, 1, 10),
    ('settings.manage', 'Управление настройками', 'Изменение системных настроек CRM', 'settings', 1, 1, 1, 20),
    ('settings.manage_cities', 'Управление городами', 'Создание и изменение городов', 'settings', 1, 1, 1, 30),
    ('settings.manage_notifications', 'Управление уведомлениями', 'Изменение настроек уведомлений', 'settings', 1, 1, 1, 40),

    -- Календарь
    ('calendar.view', 'Просмотр календаря', 'Просмотр календаря заявок', 'calendar', 0, 1, 1, 10),

    -- Уведомления
    ('notifications.view', 'Просмотр уведомлений', 'Просмотр пользовательских уведомлений', 'notifications', 0, 1, 1, 10),
    ('notifications.manage', 'Управление уведомлениями', 'Управление типами и настройками уведомлений', 'notifications', 1, 1, 1, 20),

    -- Техподдержка
    ('support_requests.view', 'Просмотр техподдержки', 'Просмотр заявок техподдержки', 'support_requests', 0, 1, 1, 10),
    ('support_requests.create', 'Создание заявок техподдержки', 'Создание заявки техподдержки', 'support_requests', 0, 1, 1, 20),
    ('support_requests.edit', 'Редактирование заявок техподдержки', 'Изменение заявки техподдержки', 'support_requests', 1, 1, 1, 30),
    ('support_requests.assign', 'Назначение исполнителя техподдержки', 'Назначение исполнителя заявки техподдержки', 'support_requests', 1, 1, 1, 40),
    ('support_requests.status.change', 'Изменение статуса техподдержки', 'Изменение статуса заявки техподдержки', 'support_requests', 0, 1, 1, 50),
    ('support_requests.delete', 'Удаление заявок техподдержки', 'Удаление заявки техподдержки', 'support_requests', 1, 1, 1, 60),
    ('support_requests.comment', 'Комментарии техподдержки', 'Комментарии к заявкам техподдержки', 'support_requests', 0, 1, 1, 70)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_dangerous = VALUES(is_dangerous),
    is_system = VALUES(is_system),
    is_active = VALUES(is_active),
    sort_order = VALUES(sort_order);


-- 11. Стандартные permissions для ADMIN и ROP: почти все права

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.is_active = 1
WHERE r.code IN ('ADMIN', 'ROP')
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);


-- 12. Стандартные permissions остальных ролей

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p
WHERE (r.code, p.code) IN (
    -- MANAGER
    ('MANAGER', 'requests.view'),
    ('MANAGER', 'requests.create'),
    ('MANAGER', 'requests.edit_own'),
    ('MANAGER', 'requests.delete_own_limited'),
    ('MANAGER', 'requests.comments.create'),
    ('MANAGER', 'clients.view'),
    ('MANAGER', 'clients.create'),
    ('MANAGER', 'clients.edit_own'),
    ('MANAGER', 'vehicles.view'),
    ('MANAGER', 'vehicles.create'),
    ('MANAGER', 'vehicles.edit'),
    ('MANAGER', 'vehicles.import'),
    ('MANAGER', 'prices.view'),
    ('MANAGER', 'prices.client.manage_own'),
    ('MANAGER', 'warehouse.view'),
    ('MANAGER', 'calendar.view'),
    ('MANAGER', 'notifications.view'),
    ('MANAGER', 'support_requests.view'),
    ('MANAGER', 'support_requests.create'),
    ('MANAGER', 'support_requests.comment'),

    -- TECH_SUPPORT
    ('TECH_SUPPORT', 'requests.view'),
    ('TECH_SUPPORT', 'requests.view_all'),
    ('TECH_SUPPORT', 'requests.create'),
    ('TECH_SUPPORT', 'requests.delete_own_limited'),
    ('TECH_SUPPORT', 'requests.comments.create'),
    ('TECH_SUPPORT', 'clients.view'),
    ('TECH_SUPPORT', 'clients.view_all'),
    ('TECH_SUPPORT', 'vehicles.view'),
    ('TECH_SUPPORT', 'vehicles.create'),
    ('TECH_SUPPORT', 'vehicles.edit'),
    ('TECH_SUPPORT', 'vehicles.import'),
    ('TECH_SUPPORT', 'prices.view'),
    ('TECH_SUPPORT', 'calendar.view'),
    ('TECH_SUPPORT', 'notifications.view'),
    ('TECH_SUPPORT', 'support_requests.view'),
    ('TECH_SUPPORT', 'support_requests.create'),
    ('TECH_SUPPORT', 'support_requests.edit'),
    ('TECH_SUPPORT', 'support_requests.assign'),
    ('TECH_SUPPORT', 'support_requests.status.change'),
    ('TECH_SUPPORT', 'support_requests.comment'),

    -- ACCOUNTANT
    ('ACCOUNTANT', 'requests.view'),
    ('ACCOUNTANT', 'requests.view_all'),
    ('ACCOUNTANT', 'requests.payment.manage'),
    ('ACCOUNTANT', 'requests.comments.create'),
    ('ACCOUNTANT', 'clients.view'),
    ('ACCOUNTANT', 'clients.view_all'),
    ('ACCOUNTANT', 'clients.status.change'),
    ('ACCOUNTANT', 'prices.view'),
    ('ACCOUNTANT', 'calendar.view'),
    ('ACCOUNTANT', 'notifications.view'),
    ('ACCOUNTANT', 'support_requests.view'),
    ('ACCOUNTANT', 'support_requests.create'),
    ('ACCOUNTANT', 'support_requests.comment'),

    -- WAREHOUSE_MANAGER
    ('WAREHOUSE_MANAGER', 'requests.view'),
    ('WAREHOUSE_MANAGER', 'requests.view_all'),
    ('WAREHOUSE_MANAGER', 'clients.view'),
    ('WAREHOUSE_MANAGER', 'clients.view_all'),
    ('WAREHOUSE_MANAGER', 'vehicles.view'),
    ('WAREHOUSE_MANAGER', 'warehouse.view'),
    ('WAREHOUSE_MANAGER', 'warehouse.manage'),
    ('WAREHOUSE_MANAGER', 'warehouse.inventory.view'),
    ('WAREHOUSE_MANAGER', 'warehouse.inventory.manage'),
    ('WAREHOUSE_MANAGER', 'calendar.view'),
    ('WAREHOUSE_MANAGER', 'notifications.view'),
    ('WAREHOUSE_MANAGER', 'support_requests.view'),
    ('WAREHOUSE_MANAGER', 'support_requests.create'),
    ('WAREHOUSE_MANAGER', 'support_requests.comment'),

    -- SENIOR_TECHNICIAN
    ('SENIOR_TECHNICIAN', 'requests.view'),
    ('SENIOR_TECHNICIAN', 'requests.view_all'),
    ('SENIOR_TECHNICIAN', 'requests.status.change'),
    ('SENIOR_TECHNICIAN', 'requests.executors.manage'),
    ('SENIOR_TECHNICIAN', 'requests.complete_any'),
    ('SENIOR_TECHNICIAN', 'requests.comments.create'),
    ('SENIOR_TECHNICIAN', 'vehicles.view'),
    ('SENIOR_TECHNICIAN', 'warehouse.view'),
    ('SENIOR_TECHNICIAN', 'warehouse.inventory.view'),
    ('SENIOR_TECHNICIAN', 'calendar.view'),
    ('SENIOR_TECHNICIAN', 'notifications.view'),

    -- TECHNICIAN
    ('TECHNICIAN', 'requests.view'),
    ('TECHNICIAN', 'requests.complete_own'),
    ('TECHNICIAN', 'requests.comments.create'),
    ('TECHNICIAN', 'vehicles.view'),
    ('TECHNICIAN', 'warehouse.view'),
    ('TECHNICIAN', 'warehouse.inventory.view'),
    ('TECHNICIAN', 'calendar.view'),
    ('TECHNICIAN', 'notifications.view')
)
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);


-- 13. LOCKED_CORE права, которые нельзя будет отключать через DENY

UPDATE role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
SET rp.is_locked_core = 1
WHERE (r.code, p.code) IN (
    ('ADMIN', 'roles.view'),
    ('ADMIN', 'employees.view'),

    ('ROP', 'requests.view'),
    ('ROP', 'clients.view'),

    ('MANAGER', 'requests.view'),
    ('MANAGER', 'requests.create'),
    ('MANAGER', 'clients.view'),

    ('TECH_SUPPORT', 'requests.view'),
    ('TECH_SUPPORT', 'requests.create'),
    ('TECH_SUPPORT', 'clients.view'),
    ('TECH_SUPPORT', 'support_requests.view'),

    ('ACCOUNTANT', 'requests.view'),
    ('ACCOUNTANT', 'requests.payment.manage'),
    ('ACCOUNTANT', 'prices.view'),

    ('WAREHOUSE_MANAGER', 'warehouse.view'),
    ('WAREHOUSE_MANAGER', 'warehouse.manage'),

    ('SENIOR_TECHNICIAN', 'requests.view'),
    ('SENIOR_TECHNICIAN', 'requests.executors.manage'),
    ('SENIOR_TECHNICIAN', 'requests.status.change'),

    ('TECHNICIAN', 'requests.view'),
    ('TECHNICIAN', 'requests.complete_own')
);


-- 14. Dependencies permissions

INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM permissions p
JOIN permissions required
WHERE (p.code, required.code) IN (
    ('requests.view_all', 'requests.view'),
    ('requests.create', 'requests.view'),
    ('requests.edit_all', 'requests.view'),
    ('requests.edit_own', 'requests.view'),
    ('requests.payment.manage', 'requests.view'),
    ('requests.status.change', 'requests.view'),
    ('requests.delete_any', 'requests.view'),
    ('requests.delete_own_limited', 'requests.view'),
    ('requests.executors.manage', 'requests.view'),
    ('requests.complete_own', 'requests.view'),
    ('requests.complete_any', 'requests.view'),
    ('requests.comments.create', 'requests.view'),

    ('clients.view_all', 'clients.view'),
    ('clients.create', 'clients.view'),
    ('clients.edit_all', 'clients.view'),
    ('clients.edit_own', 'clients.view'),
    ('clients.status.change', 'clients.view'),
    ('clients.responsible.reassign', 'clients.view'),
    ('clients.delete', 'clients.view'),
    ('clients.restore', 'clients.view'),

    ('vehicles.create', 'vehicles.view'),
    ('vehicles.edit', 'vehicles.view'),
    ('vehicles.delete', 'vehicles.view'),
    ('vehicles.import', 'vehicles.view'),

    ('prices.base.manage', 'prices.view'),
    ('prices.client.manage_all', 'prices.view'),
    ('prices.client.manage_own', 'prices.view'),

    ('warehouse.manage', 'warehouse.view'),
    ('warehouse.inventory.manage', 'warehouse.inventory.view'),

    ('employees.manage', 'employees.view'),
    ('employees.approve', 'employees.view'),
    ('employees.delete', 'employees.view'),
    ('employees.roles.change', 'employees.view'),
    ('employees.permissions.manage', 'employees.view'),

    ('roles.manage', 'roles.view'),
    ('roles.create', 'roles.manage'),
    ('roles.edit', 'roles.manage'),
    ('roles.delete_custom', 'roles.manage'),

    ('settings.manage', 'settings.view'),
    ('settings.manage_cities', 'settings.manage'),
    ('settings.manage_notifications', 'settings.manage'),

    ('notifications.manage', 'notifications.view'),

    ('support_requests.create', 'support_requests.view'),
    ('support_requests.edit', 'support_requests.view'),
    ('support_requests.assign', 'support_requests.view'),
    ('support_requests.status.change', 'support_requests.view'),
    ('support_requests.delete', 'support_requests.view'),
    ('support_requests.comment', 'support_requests.view')
)
ON DUPLICATE KEY UPDATE
    permission_id = VALUES(permission_id);


-- 15. Security flags для всех текущих пользователей

INSERT INTO user_security_flags (
    user_id,
    is_super_admin,
    is_owner,
    created_at,
    updated_at
)
SELECT
    id,
    0,
    0,
    NOW(),
    NOW()
FROM users
ON DUPLICATE KEY UPDATE
    user_id = VALUES(user_id);

UPDATE user_security_flags
SET is_super_admin = 1,
    is_owner = 1,
    updated_at = NOW()
WHERE user_id = @OWNER_USER_ID;


-- 16. Audit log начальной инициализации

INSERT INTO access_audit_log (
    actor_user_id,
    target_user_id,
    target_role_id,
    action,
    old_value,
    new_value,
    reason
)
VALUES (
    NULL,
    @OWNER_USER_ID,
    NULL,
    'ACCESS_CONTROL_INITIALIZED',
    NULL,
    JSON_OBJECT(
        'owner_user_id', @OWNER_USER_ID,
        'is_super_admin', true,
        'is_owner', true
    ),
    'Initial access control migration'
);

COMMIT;