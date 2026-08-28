-- Вариант А: управление ролями остаётся исключительно за флагом Супер-Админа.
-- roles.create / roles.edit / roles.manage / roles.delete_custom не проверяются нигде.
-- roles.view НЕ трогаем: он используется в can_view_access_control()
-- и ensure_can_view_role_options().

-- 1. Зависимости, где мёртвый код — потомок (roles.create -> roles.manage и т.д.).
DELETE pd
FROM permission_dependencies pd
JOIN permissions p ON p.id = pd.permission_id
WHERE p.code IN ('roles.create', 'roles.edit', 'roles.manage', 'roles.delete_custom');

-- 2. Зависимости, где мёртвый код — родитель (roles.manage -> roles.view).
DELETE pd
FROM permission_dependencies pd
JOIN permissions p ON p.id = pd.required_permission_id
WHERE p.code IN ('roles.create', 'roles.edit', 'roles.manage', 'roles.delete_custom');

-- 3. Индивидуальные оверрайды сотрудников.
DELETE upo
FROM user_permission_overrides upo
JOIN permissions p ON p.id = upo.permission_id
WHERE p.code IN ('roles.create', 'roles.edit', 'roles.manage', 'roles.delete_custom');

-- 4. Привязки к ролям (сейчас — ADMIN и ROP).
DELETE rp
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('roles.create', 'roles.edit', 'roles.manage', 'roles.delete_custom');

-- 5. Сам каталог.
DELETE FROM permissions
WHERE code IN ('roles.create', 'roles.edit', 'roles.manage', 'roles.delete_custom');

-- Проверка
SELECT code, name FROM permissions WHERE category = 'roles';