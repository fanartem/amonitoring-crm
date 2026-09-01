-- Перенос машины в рамках своих клиентов.
-- Зависимость на vehicles.transfer НЕ ставим: в этой схеме зависимости
-- отдают пользователю родительский код и расширяют доступ до «любой клиент».

INSERT INTO permissions (code, name, description, category, is_dangerous, is_system, is_active, sort_order)
SELECT
    'vehicles.transfer_own',
    'Перенос машин своих клиентов',
    'Позволяет перенести машину между клиентами, если пользователь является создателем или ответственным менеджером обоих клиентов.',
    'VEHICLES',
    0,
    0,
    1,
    COALESCE((SELECT MAX(sort_order) FROM permissions p2 WHERE p2.category = 'VEHICLES'), 0) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'vehicles.transfer_own'
);

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.code = 'vehicles.transfer_own'
WHERE r.code = 'MANAGER'
  AND NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );