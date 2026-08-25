/*
  Seed for Reports permissions.
  Compatible with current access-control schema:
  - permissions.id / permissions.code
  - permission_dependencies.permission_id / permission_dependencies.required_permission_id
  - role_permissions.role_id / role_permissions.permission_id
*/

INSERT INTO permissions (code, name, description, category, is_active, sort_order)
VALUES
('reports.view', 'Просмотр отчётов', 'Позволяет открывать раздел отчётов', 'REPORTS', 1, 600),
('reports.manage', 'Полный доступ к отчётам', 'Позволяет просматривать все отчёты и денежные показатели', 'REPORTS', 1, 601),

('reports.requests.view', 'Отчёты по заявкам', 'Позволяет просматривать отчёты по заявкам', 'REPORTS', 1, 610),
('reports.requests.view_all', 'Отчёты по всем заявкам', 'Позволяет видеть отчёты по всем заявкам', 'REPORTS', 1, 611),
('reports.requests.view_own', 'Отчёты по своим заявкам', 'Позволяет видеть отчёты по своим клиентам и созданным заявкам', 'REPORTS', 1, 612),

('reports.managers.view', 'Отчёты по менеджерам', 'Позволяет смотреть рейтинг и персональные отчёты менеджеров', 'REPORTS', 1, 620),
('reports.warehouse.view', 'Отчёты по складу', 'Позволяет смотреть складские отчёты по остаткам и движениям', 'REPORTS', 1, 630),
('warehouse.reports.view', 'Складские отчёты', 'Алиас доступа для просмотра отчётов по складу', 'WAREHOUSE', 1, 631),

('reports.money.view', 'Денежные показатели в отчётах', 'Позволяет видеть суммы оплат и стоимости заявок в отчётах', 'REPORTS', 1, 640)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_active = 1,
    sort_order = VALUES(sort_order);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, required.id
FROM (
    SELECT 'reports.manage' AS permission_code, 'reports.view' AS required_code UNION ALL
    SELECT 'reports.manage', 'reports.requests.view_all' UNION ALL
    SELECT 'reports.manage', 'reports.managers.view' UNION ALL
    SELECT 'reports.manage', 'reports.warehouse.view' UNION ALL
    SELECT 'reports.manage', 'reports.money.view' UNION ALL

    SELECT 'reports.requests.view_all', 'reports.requests.view' UNION ALL
    SELECT 'reports.requests.view_own', 'reports.requests.view' UNION ALL
    SELECT 'reports.requests.view', 'reports.view' UNION ALL
    SELECT 'reports.managers.view', 'reports.requests.view_all' UNION ALL
    SELECT 'reports.warehouse.view', 'reports.view' UNION ALL
    SELECT 'warehouse.reports.view', 'reports.warehouse.view' UNION ALL
    SELECT 'reports.money.view', 'reports.view'
) dep
INNER JOIN permissions p ON p.code = dep.permission_code
INNER JOIN permissions required ON required.code = dep.required_code;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
    SELECT 'ADMIN' AS role_code, 'reports.manage' AS permission_code UNION ALL
    SELECT 'ADMIN', 'reports.view' UNION ALL
    SELECT 'ADMIN', 'reports.requests.view_all' UNION ALL
    SELECT 'ADMIN', 'reports.managers.view' UNION ALL
    SELECT 'ADMIN', 'reports.warehouse.view' UNION ALL
    SELECT 'ADMIN', 'reports.money.view' UNION ALL

    SELECT 'ROP', 'reports.manage' UNION ALL
    SELECT 'ROP', 'reports.view' UNION ALL
    SELECT 'ROP', 'reports.requests.view_all' UNION ALL
    SELECT 'ROP', 'reports.managers.view' UNION ALL
    SELECT 'ROP', 'reports.money.view' UNION ALL

    SELECT 'MANAGER', 'reports.view' UNION ALL
    SELECT 'MANAGER', 'reports.requests.view_own' UNION ALL
    SELECT 'MANAGER', 'reports.money.view' UNION ALL

    SELECT 'TECH_SUPPORT', 'reports.view' UNION ALL
    SELECT 'TECH_SUPPORT', 'reports.requests.view_all' UNION ALL
    SELECT 'TECH_SUPPORT', 'reports.money.view' UNION ALL

    SELECT 'ACCOUNTANT', 'reports.view' UNION ALL
    SELECT 'ACCOUNTANT', 'reports.requests.view_all' UNION ALL
    SELECT 'ACCOUNTANT', 'reports.money.view' UNION ALL

    SELECT 'WAREHOUSE_MANAGER', 'reports.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'reports.warehouse.view' UNION ALL
    SELECT 'WAREHOUSE_MANAGER', 'warehouse.reports.view'
) rp_seed
INNER JOIN roles r ON r.code = rp_seed.role_code
INNER JOIN permissions p ON p.code = rp_seed.permission_code;

SELECT 'report permissions seed applied' AS result;