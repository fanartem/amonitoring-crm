-- Область видимости файлов: все файлы или только загруженные самим пользователем.
-- Право attachments.view (и его entity-версии) отвечает за "можно ли вообще
-- работать с файлами", эти два кода — "чьи именно файлы видно".

INSERT INTO permissions
    (code, name, description, category, is_dangerous, is_system, is_active, sort_order)
VALUES
    ('attachments.view_all',
     'Файлы всех сотрудников',
     'Позволяет видеть и скачивать файлы, загруженные любым сотрудником.',
     'ATTACHMENTS', 1, 0, 1, 130),
    ('attachments.view_own',
     'Только свои файлы',
     'Позволяет видеть только те файлы, которые пользователь загрузил сам.',
     'ATTACHMENTS', 0, 0, 1, 131)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    is_active = 1;

-- Обе области требуют базового права на файлы.
INSERT INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
JOIN permissions req ON req.code = 'attachments.view'
WHERE p.code IN ('attachments.view_all', 'attachments.view_own')
ON DUPLICATE KEY UPDATE permission_id = permission_dependencies.permission_id;

-- Кто работает с файлами сейчас — видит все, кроме монтажников.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT DISTINCT rp.role_id, target.id, 0
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id
JOIN roles r ON r.id = rp.role_id
JOIN permissions target ON target.code = 'attachments.view_all'
WHERE src.code IN ('attachments.view', 'attachments.manage')
  AND r.code NOT IN ('TECHNICIAN', 'SENIOR_TECHNICIAN')
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

-- Монтажникам — только свои.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, target.id, 0
FROM roles r
JOIN permissions target ON target.code = 'attachments.view_own'
WHERE r.code IN ('TECHNICIAN', 'SENIOR_TECHNICIAN')
ON DUPLICATE KEY UPDATE role_permissions.is_locked_core = role_permissions.is_locked_core;

SELECT r.code, p.code
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('attachments.view_all', 'attachments.view_own')
ORDER BY r.code;