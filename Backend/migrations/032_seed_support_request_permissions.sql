/*
  Seed for Support Requests permissions.
  Compatible with current access-control schema:
  - permissions.id / permissions.code
  - permission_dependencies.permission_id / permission_dependencies.required_permission_id
  - role_permissions.role_id / role_permissions.permission_id
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('support_requests.view', 'Просмотр заявок техподдержки', 'Позволяет просматривать раздел и список заявок техподдержки', 'SUPPORT_REQUESTS', 1, 700),
('support_requests.create', 'Создание заявок техподдержки', 'Позволяет создавать заявки техподдержки', 'SUPPORT_REQUESTS', 1, 701),
('support_requests.edit', 'Редактирование заявок техподдержки', 'Позволяет изменять клиента, автомобиль, контакт, описание и приоритет заявки техподдержки', 'SUPPORT_REQUESTS', 1, 702),
('support_requests.assign', 'Назначение исполнителя техподдержки', 'Позволяет назначать исполнителя заявки техподдержки', 'SUPPORT_REQUESTS', 1, 703),
('support_requests.status.manage', 'Изменение статуса техподдержки', 'Позволяет менять статус заявки техподдержки', 'SUPPORT_REQUESTS', 1, 704),
('support_requests.change_status', 'Изменение статуса техподдержки', 'Алиас доступа для изменения статуса заявки техподдержки', 'SUPPORT_REQUESTS', 1, 705),
('support_requests.comment', 'Комментарии техподдержки', 'Позволяет оставлять комментарии в заявках техподдержки', 'SUPPORT_REQUESTS', 1, 706),
('support_requests.delete', 'Удаление заявок техподдержки', 'Позволяет удалять заявки техподдержки', 'SUPPORT_REQUESTS', 1, 707),
('support_requests.manage', 'Полное управление техподдержкой', 'Позволяет полностью управлять заявками техподдержки', 'SUPPORT_REQUESTS', 1, 708)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'support_requests.manage' AS permission_code, 'support_requests.view' AS required_code UNION ALL
    SELECT 'support_requests.manage', 'support_requests.create' UNION ALL
    SELECT 'support_requests.manage', 'support_requests.edit' UNION ALL
    SELECT 'support_requests.manage', 'support_requests.assign' UNION ALL
    SELECT 'support_requests.manage', 'support_requests.status.manage' UNION ALL
    SELECT 'support_requests.manage', 'support_requests.comment' UNION ALL
    SELECT 'support_requests.manage', 'support_requests.delete' UNION ALL

    SELECT 'support_requests.create', 'support_requests.view' UNION ALL
    SELECT 'support_requests.edit', 'support_requests.view' UNION ALL
    SELECT 'support_requests.assign', 'support_requests.view' UNION ALL
    SELECT 'support_requests.status.manage', 'support_requests.view' UNION ALL
    SELECT 'support_requests.change_status', 'support_requests.status.manage' UNION ALL
    SELECT 'support_requests.comment', 'support_requests.view' UNION ALL
    SELECT 'support_requests.delete', 'support_requests.view'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'support_requests.manage' AS permission_code UNION ALL
    SELECT 'ADMIN', 'support_requests.view' UNION ALL
    SELECT 'ADMIN', 'support_requests.create' UNION ALL
    SELECT 'ADMIN', 'support_requests.edit' UNION ALL
    SELECT 'ADMIN', 'support_requests.assign' UNION ALL
    SELECT 'ADMIN', 'support_requests.status.manage' UNION ALL
    SELECT 'ADMIN', 'support_requests.comment' UNION ALL
    SELECT 'ADMIN', 'support_requests.delete' UNION ALL

    SELECT 'ROP', 'support_requests.manage' UNION ALL
    SELECT 'ROP', 'support_requests.view' UNION ALL
    SELECT 'ROP', 'support_requests.create' UNION ALL
    SELECT 'ROP', 'support_requests.edit' UNION ALL
    SELECT 'ROP', 'support_requests.assign' UNION ALL
    SELECT 'ROP', 'support_requests.status.manage' UNION ALL
    SELECT 'ROP', 'support_requests.comment' UNION ALL
    SELECT 'ROP', 'support_requests.delete' UNION ALL

    SELECT 'TECH_SUPPORT', 'support_requests.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.create' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.edit' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.assign' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.status.manage' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.change_status' UNION ALL
    SELECT 'TECH_SUPPORT', 'support_requests.comment' UNION ALL

    SELECT 'MANAGER', 'support_requests.view' UNION ALL
    SELECT 'MANAGER', 'support_requests.create' UNION ALL
    SELECT 'MANAGER', 'support_requests.comment' UNION ALL

    SELECT 'ACCOUNTANT', 'support_requests.view' UNION ALL
    SELECT 'ACCOUNTANT', 'support_requests.create' UNION ALL
    SELECT 'ACCOUNTANT', 'support_requests.comment' UNION ALL

    SELECT 'WAREHOUSE_MANAGER', 'support_requests.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'support_requests.create' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'support_requests.comment'
) rp_seed
INNER JOIN roles r ON r.code = rp_seed.role_code
INNER JOIN permissions p ON p.code = rp_seed.permission_code;

SELECT 'support request permissions seed applied' AS result;