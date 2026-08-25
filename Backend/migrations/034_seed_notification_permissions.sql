/*
  Seed for Notification settings permissions.
  Compatible with current access-control schema:
  - permissions.id / permissions.code
  - permission_dependencies.permission_id / permission_dependencies.required_permission_id
  - role_permissions.role_id / role_permissions.permission_id
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('notifications.settings.manage', 'Управление настройками уведомлений', 'Позволяет управлять административными настройками уведомлений', 'NOTIFICATIONS', 1, 700),
('notifications.request_time_conflict.manage', 'Настройка пересечений заявок', 'Позволяет выбирать города, игнорируемые в уведомлениях о пересечении заявок', 'NOTIFICATIONS', 1, 701),
('settings.notifications.manage', 'Настройки уведомлений', 'Алиас доступа для управления настройками уведомлений в разделе настроек', 'SETTINGS', 1, 702)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'notifications.request_time_conflict.manage' AS permission_code, 'notifications.settings.manage' AS required_code UNION ALL
    SELECT 'settings.notifications.manage', 'notifications.settings.manage'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'notifications.settings.manage' AS permission_code UNION ALL
    SELECT 'ADMIN', 'notifications.request_time_conflict.manage' UNION ALL
    SELECT 'ADMIN', 'settings.notifications.manage'
) rp_seed
INNER JOIN roles r ON r.code = rp_seed.role_code
INNER JOIN permissions p ON p.code = rp_seed.permission_code;

SELECT 'notification permissions seed applied' AS result;