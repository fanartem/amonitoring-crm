-- vehicles.restore и vehicles.transfer есть в каталоге, но не выданы
-- ни одной роли. Из-за этого PATCH /vehicles/{id}/restore и
-- POST /vehicles/{id}/transfer-client отвечают 403 всем.

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p
  ON p.code IN ('vehicles.restore', 'vehicles.transfer')
WHERE r.code IN ('ADMIN', 'ROP')
  AND NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = r.id
        AND rp.permission_id = p.id
  );