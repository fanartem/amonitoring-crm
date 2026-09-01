-- 1. Менеджеру — область "свои клиенты".
-- Без этого после правки CLIENT_VIEW_ALL_PERMISSION_CODES он перестанет
-- видеть карточки вообще: у него сейчас нет ни view_all, ни view_own.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.code = 'clients.view_own'
WHERE r.code = 'MANAGER'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- 2. Пароль мониторинга: управление учётными данными теперь требует права
-- на просмотр пароля. Раньше код спрашивал clients.monitoring_password.view,
-- а у ролей стоял clients.monitoring_credentials.manage — пересечения не было,
-- и пароль не видел никто, включая админа.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
JOIN permissions req ON req.code = 'clients.monitoring_password.view'
WHERE p.code = 'clients.monitoring_credentials.manage'
ON DUPLICATE KEY UPDATE permission_id = permission_dependencies.permission_id;

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT DISTINCT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id
JOIN permissions target ON target.code = 'clients.monitoring_password.view'
WHERE src.code = 'clients.monitoring_credentials.manage'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- 3. Корзина клиентов: отдельное право вместо "кто умеет удалять — тот и видит".
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT DISTINCT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id
JOIN permissions target ON target.code = 'clients.trash.view'
WHERE src.code IN ('clients.delete', 'clients.restore')
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- 4. Проверка:
SELECT r.code, p.code
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('clients.view_own', 'clients.monitoring_password.view', 'clients.trash.view')
ORDER BY p.code, r.code;