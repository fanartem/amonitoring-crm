INSERT INTO permissions
    (code, name, description, category, is_dangerous, is_system, is_active, sort_order)
VALUES
    ('clients.attachments.view_all',
     'Файлы всех клиентов',
     'Позволяет просматривать и скачивать файлы всех клиентов.',
     'ATTACHMENTS', 1, 0, 1, 120),
    ('clients.attachments.view_own',
     'Файлы своих клиентов',
     'Позволяет просматривать файлы только тех клиентов, где пользователь создатель или ответственный.',
     'ATTACHMENTS', 0, 0, 1, 121)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    is_active = 1;

-- Кто видел всех клиентов — видит и их файлы.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src
    ON src.id = rp.permission_id
   AND src.code = 'clients.view_all'
JOIN permissions target
    ON target.code = 'clients.attachments.view_all'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- Менеджеру — только свои.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.code = 'clients.attachments.view_own'
WHERE r.code = 'MANAGER'
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;