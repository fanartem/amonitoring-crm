-- admin.access появилось в шаге 54 как обёртка над get_current_admin.
-- Функция удалена (шаг 247), эндпоинты переведены на конкретные права,
-- проверок по этому коду в коде не осталось.
-- Строку не удаляем: она нужна для истории выдач. Снимаем выдачи и гасим,
-- чтобы галочка исчезла из Settings.

DELETE rp
FROM role_permissions rp
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'admin.access';

DELETE upo
FROM user_permission_overrides upo
INNER JOIN permissions p ON p.id = upo.permission_id
WHERE p.code = 'admin.access';

DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
WHERE p.code = 'admin.access';

DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE req.code = 'admin.access';

UPDATE permissions
SET is_active = 0
WHERE code = 'admin.access';