/*
  Seed for Attachment permissions.
  Compatible with current access-control schema:
  - permissions.id / permissions.code
  - permission_dependencies.permission_id / permission_dependencies.required_permission_id
  - role_permissions.role_id / role_permissions.permission_id
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('attachments.view', 'Просмотр файлов', 'Позволяет просматривать и скачивать прикреплённые файлы.', 'ATTACHMENTS', 1, 800),
('attachments.upload', 'Загрузка файлов', 'Позволяет загружать прикреплённые файлы.', 'ATTACHMENTS', 1, 801),
('attachments.rename', 'Переименование файлов', 'Позволяет переименовывать прикреплённые файлы.', 'ATTACHMENTS', 1, 802),
('attachments.edit', 'Редактирование файлов', 'Алиас для переименования прикреплённых файлов.', 'ATTACHMENTS', 1, 803),
('attachments.delete', 'Удаление файлов', 'Позволяет удалять прикреплённые файлы.', 'ATTACHMENTS', 1, 804),
('attachments.manage', 'Полное управление файлами', 'Позволяет просматривать, загружать, переименовывать и удалять прикреплённые файлы.', 'ATTACHMENTS', 1, 805),

('clients.attachments.view', 'Просмотр файлов клиентов', 'Позволяет просматривать файлы, прикреплённые к клиентам.', 'ATTACHMENTS', 1, 810),
('clients.attachments.upload', 'Загрузка файлов клиентов', 'Позволяет загружать файлы к клиентам.', 'ATTACHMENTS', 1, 811),
('clients.attachments.rename', 'Переименование файлов клиентов', 'Позволяет переименовывать файлы клиентов.', 'ATTACHMENTS', 1, 812),
('clients.attachments.edit', 'Редактирование файлов клиентов', 'Алиас для переименования файлов клиентов.', 'ATTACHMENTS', 1, 813),
('clients.attachments.delete', 'Удаление файлов клиентов', 'Позволяет удалять файлы клиентов.', 'ATTACHMENTS', 1, 814),
('clients.attachments.manage', 'Управление файлами клиентов', 'Позволяет полностью управлять файлами клиентов.', 'ATTACHMENTS', 1, 815),

('requests.attachments.view', 'Просмотр файлов заявок', 'Позволяет просматривать файлы, прикреплённые к заявкам.', 'ATTACHMENTS', 1, 820),
('requests.attachments.upload', 'Загрузка файлов заявок', 'Позволяет загружать файлы к заявкам.', 'ATTACHMENTS', 1, 821),
('requests.attachments.rename', 'Переименование файлов заявок', 'Позволяет переименовывать файлы заявок.', 'ATTACHMENTS', 1, 822),
('requests.attachments.edit', 'Редактирование файлов заявок', 'Алиас для переименования файлов заявок.', 'ATTACHMENTS', 1, 823),
('requests.attachments.delete', 'Удаление файлов заявок', 'Позволяет удалять файлы заявок.', 'ATTACHMENTS', 1, 824),
('requests.attachments.manage', 'Управление файлами заявок', 'Позволяет полностью управлять файлами заявок.', 'ATTACHMENTS', 1, 825)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'attachments.upload' AS permission_code, 'attachments.view' AS required_code UNION ALL
    SELECT 'attachments.rename', 'attachments.view' UNION ALL
    SELECT 'attachments.edit', 'attachments.rename' UNION ALL
    SELECT 'attachments.delete', 'attachments.view' UNION ALL
    SELECT 'attachments.manage', 'attachments.view' UNION ALL
    SELECT 'attachments.manage', 'attachments.upload' UNION ALL
    SELECT 'attachments.manage', 'attachments.rename' UNION ALL
    SELECT 'attachments.manage', 'attachments.delete' UNION ALL

    SELECT 'clients.attachments.view', 'attachments.view' UNION ALL
    SELECT 'clients.attachments.upload', 'clients.attachments.view' UNION ALL
    SELECT 'clients.attachments.rename', 'clients.attachments.view' UNION ALL
    SELECT 'clients.attachments.edit', 'clients.attachments.rename' UNION ALL
    SELECT 'clients.attachments.delete', 'clients.attachments.view' UNION ALL
    SELECT 'clients.attachments.manage', 'clients.attachments.view' UNION ALL
    SELECT 'clients.attachments.manage', 'clients.attachments.upload' UNION ALL
    SELECT 'clients.attachments.manage', 'clients.attachments.rename' UNION ALL
    SELECT 'clients.attachments.manage', 'clients.attachments.delete' UNION ALL

    SELECT 'requests.attachments.view', 'attachments.view' UNION ALL
    SELECT 'requests.attachments.upload', 'requests.attachments.view' UNION ALL
    SELECT 'requests.attachments.rename', 'requests.attachments.view' UNION ALL
    SELECT 'requests.attachments.edit', 'requests.attachments.rename' UNION ALL
    SELECT 'requests.attachments.delete', 'requests.attachments.view' UNION ALL
    SELECT 'requests.attachments.manage', 'requests.attachments.view' UNION ALL
    SELECT 'requests.attachments.manage', 'requests.attachments.upload' UNION ALL
    SELECT 'requests.attachments.manage', 'requests.attachments.rename' UNION ALL
    SELECT 'requests.attachments.manage', 'requests.attachments.delete'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'attachments.manage' AS permission_code UNION ALL
    SELECT 'ADMIN', 'clients.attachments.manage' UNION ALL
    SELECT 'ADMIN', 'requests.attachments.manage' UNION ALL

    SELECT 'ROP', 'attachments.manage' UNION ALL
    SELECT 'ROP', 'clients.attachments.manage' UNION ALL
    SELECT 'ROP', 'requests.attachments.manage' UNION ALL

    SELECT 'MANAGER', 'attachments.view' UNION ALL
    SELECT 'MANAGER', 'attachments.upload' UNION ALL
    SELECT 'MANAGER', 'attachments.rename' UNION ALL
    SELECT 'MANAGER', 'clients.attachments.view' UNION ALL
    SELECT 'MANAGER', 'clients.attachments.upload' UNION ALL
    SELECT 'MANAGER', 'clients.attachments.rename' UNION ALL
    SELECT 'MANAGER', 'requests.attachments.view' UNION ALL
    SELECT 'MANAGER', 'requests.attachments.upload' UNION ALL
    SELECT 'MANAGER', 'requests.attachments.rename' UNION ALL

    SELECT 'TECH_SUPPORT', 'attachments.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'attachments.upload' UNION ALL
    SELECT 'TECH_SUPPORT', 'clients.attachments.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'clients.attachments.upload' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.attachments.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.attachments.upload' UNION ALL

    SELECT 'ACCOUNTANT', 'attachments.view' UNION ALL
    SELECT 'ACCOUNTANT', 'clients.attachments.view' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.attachments.view' UNION ALL

    SELECT 'WAREHOUSE_MANAGER', 'attachments.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'attachments.upload' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'requests.attachments.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'requests.attachments.upload' UNION ALL

    SELECT 'SENIOR_TECHNICIAN', 'attachments.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'attachments.upload' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.attachments.view' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.attachments.upload' UNION ALL

    SELECT 'TECHNICIAN', 'attachments.view' UNION ALL
    SELECT 'TECHNICIAN', 'attachments.upload' UNION ALL
    SELECT 'TECHNICIAN', 'requests.attachments.view' UNION ALL
    SELECT 'TECHNICIAN', 'requests.attachments.upload'
) grants
INNER JOIN roles r ON r.code = grants.role_code
INNER JOIN permissions p ON p.code = grants.permission_code;