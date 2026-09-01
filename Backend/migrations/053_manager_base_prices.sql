-- migrations/2026_09_01_manager_base_prices.sql
-- Менеджер сохраняет индивидуальные цены своих клиентов и просмотр прайса,
-- но перестаёт править общий прайс компании.

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'MANAGER'
  AND p.code = 'base_prices.manage';