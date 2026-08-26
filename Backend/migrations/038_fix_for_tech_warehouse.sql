SELECT r.code AS role_code, r.name AS role_name, p.code, p.name
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN (
    'warehouse.inventory.view',
    'warehouse.inventory.view_all',
    'warehouse.inventory.manage',
    'warehouse.inventory.manage_all',
    'warehouse.employee_inventory.view',
    'warehouse.employee_inventory.manage'
)
ORDER BY r.code, p.code;

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'TECHNICIAN'
  AND p.code = 'warehouse.inventory.view';