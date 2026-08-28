DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'MANAGER'
  AND p.code IN (
      'base_prices.manage',
      'base_prices.create',
      'base_prices.edit',
      'base_prices.delete',
      'base_prices.restore'
  );