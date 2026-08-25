/*
  Seed for Calendar permissions.
  Compatible with current access-control schema:
  - permissions.id / permissions.code
  - permission_dependencies.permission_id / permission_dependencies.required_permission_id
  - role_permissions.role_id / role_permissions.permission_id
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('calendar.view', 'Просмотр календаря', 'Позволяет открывать раздел календаря заявок', 'REQUESTS', 1, 270),
('calendar.view_all', 'Просмотр всего календаря', 'Позволяет видеть общий календарь заявок и фильтровать по городам', 'REQUESTS', 1, 271),
('requests.calendar.view', 'Календарь заявок', 'Позволяет просматривать календарь заявок', 'REQUESTS', 1, 272),
('requests.calendar.view_all', 'Общий календарь заявок', 'Позволяет просматривать общий календарь заявок', 'REQUESTS', 1, 273)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'calendar.view_all' AS permission_code, 'calendar.view' AS required_code UNION ALL
    SELECT 'requests.calendar.view', 'calendar.view' UNION ALL
    SELECT 'requests.calendar.view_all', 'requests.calendar.view' UNION ALL
    SELECT 'requests.calendar.view_all', 'calendar.view_all'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'requests.calendar.view_all' AS permission_code UNION ALL
    SELECT 'ROP', 'requests.calendar.view_all' UNION ALL
    SELECT 'MANAGER', 'requests.calendar.view_all' UNION ALL
    SELECT 'TECH_SUPPORT', 'requests.calendar.view_all' UNION ALL
    SELECT 'ACCOUNTANT', 'requests.calendar.view_all' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'requests.calendar.view_all' UNION ALL
    SELECT 'SENIOR_TECHNICIAN', 'requests.calendar.view_all' UNION ALL
    SELECT 'TECHNICIAN', 'requests.calendar.view'
) rp_seed
INNER JOIN roles r ON r.code = rp_seed.role_code
INNER JOIN permissions p ON p.code = rp_seed.permission_code;

SELECT 'calendar permissions seed applied' AS result;