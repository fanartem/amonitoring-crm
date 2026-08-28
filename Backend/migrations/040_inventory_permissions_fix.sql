-- Переносим роли со скрытых алиасов на видимые коды.

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src
    ON src.id = rp.permission_id
   AND src.code = 'warehouse.inventory.view'
JOIN permissions target
    ON target.code = 'warehouse.inventory.view_all'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src
    ON src.id = rp.permission_id
   AND src.code = 'warehouse.inventory.manage'
JOIN permissions target
    ON target.code = 'warehouse.inventory.manage_all'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- Снимаем скрытые алиасы с ролей.
DELETE rp
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('warehouse.inventory.view', 'warehouse.inventory.manage');