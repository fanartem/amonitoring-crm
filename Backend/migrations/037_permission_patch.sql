/*
  Step 54 permission patch.
  Purpose:
  - add explicit permissions that replaced old role fallback checks;
  - keep current default system-role behaviour through role_permissions;
  - use id-based joins compatible with current schema.
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
-- Admin / settings
('admin.access', 'Доступ к админским функциям', 'Позволяет использовать старые endpoint-ы, которые завязаны на get_current_admin.', 'EMPLOYEES', 1, 50),

-- Request comments
('requests.comments.create', 'Добавление комментариев к заявкам', 'Позволяет добавлять комментарии в карточке заявки.', 'REQUESTS', 1, 286),
('requests.comment', 'Комментарии к заявкам', 'Алиас доступа для добавления комментариев к заявкам.', 'REQUESTS', 1, 287),
('requests.comments.manage', 'Управление комментариями заявок', 'Позволяет управлять комментариями заявок.', 'REQUESTS', 1, 288),

-- Cities
('cities.view', 'Просмотр городов', 'Позволяет просматривать справочник городов.', 'SETTINGS', 1, 700),
('cities.create', 'Создание городов', 'Позволяет добавлять новые города.', 'SETTINGS', 1, 701),
('cities.edit', 'Редактирование городов', 'Позволяет редактировать и включать/отключать города.', 'SETTINGS', 1, 702),
('cities.delete', 'Отключение городов', 'Позволяет отключать города.', 'SETTINGS', 1, 703),
('cities.deactivate', 'Отключение города', 'Алиас доступа для отключения города.', 'SETTINGS', 1, 704),
('cities.manage', 'Управление городами', 'Позволяет полностью управлять справочником городов.', 'SETTINGS', 1, 705),
('settings.cities.manage', 'Города в настройках', 'Позволяет управлять городами из раздела настроек.', 'SETTINGS', 1, 706),

-- Notifications
('notifications.view', 'Просмотр уведомлений', 'Позволяет просматривать свои уведомления.', 'NOTIFICATIONS', 1, 610),
('notifications.settings.manage', 'Настройки уведомлений', 'Позволяет управлять настройками уведомлений.', 'NOTIFICATIONS', 1, 612),
('notifications.request_time_conflict.manage', 'Настройка пересечений заявок', 'Позволяет настраивать уведомления о пересечении заявок по времени.', 'NOTIFICATIONS', 1, 613),

-- Reports alias
('reports.requests.view_own', 'Отчёты по своим заявкам', 'Позволяет видеть отчёты по своим клиентам и созданным заявкам.', 'REPORTS', 1, 520),

-- Warehouse / request equipment aliases used by strict backend gates
('warehouse.my_inventory.view', 'Мой инвентарь', 'Позволяет просматривать свой инвентарь.', 'WAREHOUSE', 1, 430),
('requests.equipment.view_own', 'Оборудование своих заявок', 'Позволяет видеть оборудование в своих/ответственных заявках.', 'WAREHOUSE', 1, 431),
('requests.equipment.view_assigned', 'Оборудование назначенных заявок', 'Позволяет исполнителю видеть оборудование назначенных заявок.', 'WAREHOUSE', 1, 432),
('warehouse.request_equipment.view_own', 'Оборудование своих заявок', 'Алиас доступа для просмотра оборудования своих заявок.', 'WAREHOUSE', 1, 433),
('warehouse.request_equipment.view_assigned', 'Оборудование назначенных заявок', 'Алиас доступа для просмотра оборудования назначенных заявок.', 'WAREHOUSE', 1, 434),
('vehicles.equipment.view', 'Просмотр оборудования автомобиля', 'Позволяет просматривать оборудование, привязанное к автомобилю.', 'VEHICLES', 1, 360),
('vehicles.equipment.view_own', 'Просмотр оборудования автомобилей своих клиентов', 'Позволяет менеджеру видеть оборудование автомобилей своих клиентов.', 'VEHICLES', 1, 361),
('vehicles.equipment.view_all', 'Просмотр оборудования всех автомобилей', 'Позволяет просматривать оборудование всех автомобилей.', 'VEHICLES', 1, 362),
('warehouse.vehicle_equipment.view', 'Просмотр оборудования автомобиля', 'Алиас доступа для просмотра оборудования автомобиля.', 'WAREHOUSE', 1, 435),
('warehouse.vehicle_equipment.view_own', 'Просмотр оборудования автомобилей своих клиентов', 'Алиас доступа для просмотра оборудования автомобилей своих клиентов.', 'WAREHOUSE', 1, 436),
('warehouse.vehicle_equipment.view_all', 'Просмотр оборудования всех автомобилей', 'Алиас доступа для просмотра оборудования всех автомобилей.', 'WAREHOUSE', 1, 437)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'requests.comment' AS permission_code, 'requests.comments.create' AS required_code UNION ALL
    SELECT 'requests.comments.manage', 'requests.comments.create' UNION ALL
    SELECT 'cities.create', 'cities.manage' UNION ALL
    SELECT 'cities.edit', 'cities.manage' UNION ALL
    SELECT 'cities.delete', 'cities.manage' UNION ALL
    SELECT 'cities.deactivate', 'cities.delete' UNION ALL
    SELECT 'settings.cities.manage', 'cities.manage' UNION ALL
    SELECT 'notifications.settings.manage', 'notifications.view' UNION ALL
    SELECT 'notifications.request_time_conflict.manage', 'notifications.settings.manage' UNION ALL
    SELECT 'reports.requests.view_own', 'reports.requests.view' UNION ALL
    SELECT 'requests.equipment.view_assigned', 'requests.equipment.view' UNION ALL
    SELECT 'requests.equipment.view_own', 'requests.equipment.view' UNION ALL
    SELECT 'warehouse.request_equipment.view_assigned', 'requests.equipment.view_assigned' UNION ALL
    SELECT 'warehouse.request_equipment.view_own', 'requests.equipment.view_own' UNION ALL
    SELECT 'vehicles.equipment.view_own', 'vehicles.equipment.view' UNION ALL
    SELECT 'vehicles.equipment.view_all', 'vehicles.equipment.view' UNION ALL
    SELECT 'warehouse.vehicle_equipment.view', 'vehicles.equipment.view' UNION ALL
    SELECT 'warehouse.vehicle_equipment.view_own', 'vehicles.equipment.view_own' UNION ALL
    SELECT 'warehouse.vehicle_equipment.view_all', 'vehicles.equipment.view_all'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    -- Admin/settings defaults
    SELECT 'ADMIN' AS role_code, 'admin.access' AS permission_code UNION ALL
    SELECT 'ADMIN', 'cities.manage' UNION ALL
    SELECT 'ADMIN', 'settings.cities.manage' UNION ALL
    SELECT 'ROP', 'cities.manage' UNION ALL
    SELECT 'ROP', 'settings.cities.manage' UNION ALL

    -- Request comments: old behaviour was broad access; UI can remove these later.
    SELECT 'ADMIN', 'requests.comments.create' UNION ALL
    SELECT 'ROP', 'requests.comments.create' UNION ALL
    SELECT 'MANAGER', 'requests.comments.create' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.comments.create' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.comments.create' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'requests.comments.create' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.comments.create' UNION ALL
    SELECT 'TECHNICIAN', 'requests.comments.create' UNION ALL

    -- Notifications
    SELECT 'ADMIN', 'notifications.view' UNION ALL
    SELECT 'ROP', 'notifications.view' UNION ALL
    SELECT 'MANAGER', 'notifications.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'notifications.view' UNION ALL
    SELECT 'ACCOUNTANT', 'notifications.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'notifications.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'notifications.view' UNION ALL
    SELECT 'TECHNICIAN', 'notifications.view' UNION ALL
    SELECT 'ADMIN', 'notifications.settings.manage' UNION ALL
    SELECT 'ADMIN', 'notifications.request_time_conflict.manage' UNION ALL

    -- Reports own
    SELECT 'MANAGER', 'reports.requests.view_own' UNION ALL
    SELECT 'TECH_SUPPORT', 'reports.requests.view_own' UNION ALL

    -- My inventory / request equipment
    SELECT 'SENIOR_TECHNICIAN', 'warehouse.my_inventory.view' UNION ALL
    SELECT 'TECHNICIAN', 'warehouse.my_inventory.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.equipment.view_assigned' UNION ALL
    SELECT 'TECHNICIAN', 'requests.equipment.view_assigned' UNION ALL
    SELECT 'MANAGER', 'requests.equipment.view_own' UNION ALL

    -- Vehicle equipment view
    SELECT 'ADMIN', 'vehicles.equipment.view_all' UNION ALL
    SELECT 'ROP', 'vehicles.equipment.view_all' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'vehicles.equipment.view_all' UNION ALL
    SELECT 'TECH_SUPPORT', 'vehicles.equipment.view_all' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'vehicles.equipment.view_all' UNION ALL
    SELECT 'MANAGER', 'vehicles.equipment.view_own'
) grants
INNER JOIN roles r ON r.code = grants.role_code
INNER JOIN permissions p ON p.code = grants.permission_code;