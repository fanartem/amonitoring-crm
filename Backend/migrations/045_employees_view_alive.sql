-- Оживляем employees.view: раздаём всем активным ролям как обязательное.
-- Право становится настраиваемым для будущих ролей, но у текущих снять его нельзя.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 1
FROM roles r
JOIN permissions p ON p.code = 'employees.view'
WHERE r.is_active = 1
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = 1;

-- На всякий случай снимаем индивидуальные DENY, если кто-то их успел проставить.
DELETE upo
FROM user_permission_overrides upo
JOIN permissions p ON p.id = upo.permission_id
WHERE p.code = 'employees.view'
  AND upo.effect = 'DENY';

SELECT r.code, rp.is_locked_core
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'employees.view'
ORDER BY r.code;