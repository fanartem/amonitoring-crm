-- Строка расчёта без кода прайса — цена, назначенная человеком.
-- Сюда попадают ручные строки калькулятора и дополнительные датчики.

INSERT INTO permissions (code, name, description, category, is_dangerous, is_system, is_active, sort_order)
SELECT
    'prices.manual_lines',
    'Ручные строки в расчёте заявки',
    'Позволяет добавлять в расчёт заявки строки с ценой, назначенной вручную: произвольные позиции и дополнительные датчики. Строки с кодом из прайса всегда считаются по прайсу.',
    'PRICES',
    1,
    0,
    1,
    COALESCE((SELECT MAX(sort_order) FROM permissions p2 WHERE p2.category = 'PRICES'), 0) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM permissions WHERE code = 'prices.manual_lines'
);

-- Выдаём всем, кто создаёт заявки: сегодня поведение не меняется,
-- но право становится настраиваемым.
INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
JOIN permissions p ON p.code = 'prices.manual_lines'
WHERE r.code IN ('ADMIN', 'ROP', 'MANAGER', 'TECH_SUPPORT')
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );