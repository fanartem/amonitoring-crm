/*
  Разворот перевёрнутых зависимостей и разрыв цикла в графе прав.
  Порядок частей важен: часть 1 сохраняет доступ, который сейчас
  раздаётся неявно, и только потом часть 2 убирает ребро.
*/

-- ЧАСТЬ 1. Кто держит calendar.view без requests.calendar.view, тот получает
-- второй код только через цикл. Выдаём явно, иначе после части 2 он пропадёт.
-- Сегодня это CEO.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, target.id
FROM role_permissions rp
INNER JOIN permissions p ON p.id = rp.permission_id
INNER JOIN permissions target ON target.code = 'requests.calendar.view'
WHERE p.code = 'calendar.view';

-- ЧАСТЬ 2. Цикл calendar.view <-> requests.calendar.view.
-- Оставляем одно направление: раздел требует общий доступ к календарю.
DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code = 'calendar.view'
  AND req.code = 'requests.calendar.view';

-- ЧАСТЬ 3. settings.manage_cities / settings.manage_notifications выдавали
-- settings.manage — полное управление ролями и правами.
-- Сегодня обе роли-держателя (ADMIN, ROP) и так имеют settings.manage,
-- поэтому правка ничего не отнимает; она закрывает будущую выдачу.
DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE req.code = 'settings.manage'
  AND p.code IN ('settings.manage_cities', 'settings.manage_notifications');

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON req.code IN ('settings.manage_cities', 'settings.manage_notifications')
WHERE p.code = 'settings.manage';

-- ЧАСТЬ 4. Города. Все четыре узких кода не выданы никому,
-- так что разворот направления никого не затрагивает.
DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE (p.code, req.code) IN (
    ('cities.create', 'cities.manage'),
    ('cities.edit', 'cities.manage'),
    ('cities.delete', 'cities.manage'),
    ('cities.deactivate', 'cities.delete')
);

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON req.code IN ('cities.create', 'cities.edit', 'cities.delete', 'cities.view')
WHERE p.code = 'cities.manage';

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req ON req.code = 'cities.view'
WHERE p.code IN ('cities.create', 'cities.edit', 'cities.delete');

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req ON req.code = 'cities.deactivate'
WHERE p.code = 'cities.delete';

-- ЧАСТЬ 5. requests.executors.assign не выдан никому, разворачиваем.
DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code = 'requests.executors.assign'
  AND req.code = 'requests.executors.manage';

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req ON req.code = 'requests.executors.assign'
WHERE p.code = 'requests.executors.manage';

-- Отдельная часть для менеджеров
-- client_prices.manage_own выдавал client_prices.manage, а тот означает
-- «цены любого клиента». Менеджер получал доступ к чужим прайсам.
DELETE pd
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code = 'client_prices.manage_own'
  AND req.code = 'client_prices.manage';