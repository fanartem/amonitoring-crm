-- vehicles.edit_all есть в каталоге, но не выдан никому.
-- Из-за этого широкая ветка can_edit_vehicle_for_client недостижима,
-- и Админ не может править машины клиентов, которых не заводил сам.

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.code = 'vehicles.edit_all'
WHERE r.code IN ('ADMIN', 'ROP')
  AND NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );