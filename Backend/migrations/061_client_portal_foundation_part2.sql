-- ============================================================================
-- Этап 3. Фундамент клиентского портала. Часть 2: каталог прав.
--
-- Применять ПОСЛЕ части 1 (нужна роль CLIENT_PORTAL).
--
-- Что делает:
--   1. добавляет 10 прав категории portal;
--   2. проставляет зависимости (что тянется автоматически);
--   3. выдаёт права роли CLIENT_PORTAL, два из них — обязательными.
--
-- Про предупреждения: конструкция VALUES() внутри ON DUPLICATE KEY UPDATE
-- в MySQL 8.0.20+ помечена как устаревшая, поэтому запросы вернут
-- несколько warnings. Это ожидаемо, поведение не меняется.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Часть 2.1. Проверка до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 0: кодов с префиксом portal. ещё нет.
SELECT COUNT(*) AS existing_portal_permissions
FROM permissions
WHERE code LIKE 'portal.%';

-- Ожидаем 1: роль из части 1 на месте.
SELECT COUNT(*) AS client_portal_role_exists
FROM roles
WHERE code = 'CLIENT_PORTAL';

-- ----------------------------------------------------------------------------
-- Часть 2.2. Права портала
-- ----------------------------------------------------------------------------

INSERT INTO permissions (
    code,
    name,
    description,
    category,
    is_dangerous,
    is_system,
    is_active,
    sort_order
)
VALUES
    (
        'portal.access',
        'Вход в клиентский портал',
        'Базовое право учётной записи клиента. Без него портал не открывается.',
        'portal', 0, 1, 1, 10
    ),
    (
        'portal.requests.view',
        'Портал: просмотр своих заявок',
        'Заявки своего клиента и его подклиентов.',
        'portal', 0, 1, 1, 20
    ),
    (
        'portal.requests.create',
        'Портал: создание заявки',
        'Создание заявки по параметрам установки из договора.',
        'portal', 0, 1, 1, 30
    ),
    (
        'portal.requests.cancel_new',
        'Портал: отмена новой заявки',
        'Отмена собственной заявки, пока она в статусе «В ожидании».',
        'portal', 0, 1, 1, 40
    ),
    (
        'portal.vehicles.view',
        'Портал: просмотр своих машин',
        'Список машин своего клиента и его подклиентов.',
        'portal', 0, 1, 1, 50
    ),
    (
        'portal.subclients.view',
        'Портал: просмотр подклиентов',
        'Вкладка подклиентов в личном кабинете.',
        'portal', 0, 1, 1, 60
    ),
    (
        'portal.subclients.create',
        'Портал: создание подклиента',
        'Клиент сам заводит подклиента в своей ветке.',
        'portal', 0, 1, 1, 70
    ),
    (
        'portal.prices.view',
        'Портал: просмотр стоимости',
        'Стоимость заявки и строки расчёта в личном кабинете.',
        'portal', 0, 1, 1, 80
    ),
    (
        'portal.installation_settings.view',
        'Портал: просмотр параметров установки',
        'Параметры установки по договору: платформа, трекер, датчики.',
        'portal', 0, 1, 1, 90
    ),
    (
        'portal.password.change',
        'Портал: смена своего пароля',
        'Смена собственного пароля клиентской учётной записью.',
        'portal', 0, 1, 1, 100
    )
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_dangerous = VALUES(is_dangerous),
    is_system = VALUES(is_system),
    is_active = 1,
    sort_order = VALUES(sort_order);

-- ----------------------------------------------------------------------------
-- Часть 2.3. Зависимости
--
-- Направление: «имеешь permission_id → автоматически получаешь required».
-- required всегда УЖЕ по смыслу, иначе право будет само себя расширять.
--
-- Транзитивность раскрывает expand_permissions_with_dependencies:
-- portal.requests.create → portal.requests.view → portal.access.
-- ----------------------------------------------------------------------------

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON (p.code = 'portal.requests.view'             AND req.code = 'portal.access')
    OR (p.code = 'portal.vehicles.view'             AND req.code = 'portal.access')
    OR (p.code = 'portal.subclients.view'           AND req.code = 'portal.access')
    OR (p.code = 'portal.prices.view'               AND req.code = 'portal.access')
    OR (p.code = 'portal.installation_settings.view' AND req.code = 'portal.access')
    OR (p.code = 'portal.password.change'           AND req.code = 'portal.access')
    OR (p.code = 'portal.requests.create'           AND req.code = 'portal.requests.view')
    OR (p.code = 'portal.requests.cancel_new'       AND req.code = 'portal.requests.view')
    OR (p.code = 'portal.subclients.create'         AND req.code = 'portal.subclients.view')
WHERE p.is_active = 1
  AND req.is_active = 1;

-- ----------------------------------------------------------------------------
-- Часть 2.4. Выдача прав роли CLIENT_PORTAL
--
-- is_locked_core = 1 только у двух:
--   portal.access          — без него учётка не входит вообще;
--   portal.password.change — почты у клиентов нет, сброс пароля только
--                            через админа, поэтому смену своего пароля
--                            снимать индивидуальным DENY нельзя.
-- Остальное настраивается в Settings по каждому клиенту.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT
    r.id,
    p.id,
    CASE
        WHEN p.code IN ('portal.access', 'portal.password.change') THEN 1
        ELSE 0
    END AS is_locked_core
FROM roles r
INNER JOIN permissions p
    ON p.code IN (
        'portal.access',
        'portal.requests.view',
        'portal.requests.create',
        'portal.requests.cancel_new',
        'portal.vehicles.view',
        'portal.subclients.view',
        'portal.subclients.create',
        'portal.prices.view',
        'portal.installation_settings.view',
        'portal.password.change'
    )
WHERE r.code = 'CLIENT_PORTAL'
  AND p.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);

-- ----------------------------------------------------------------------------
-- Часть 2.5. Проверка после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 10 строк, sort_order 10..100.
SELECT code, name, category, sort_order, is_active
FROM permissions
WHERE category = 'portal'
ORDER BY sort_order;

-- Ожидаем 9 строк зависимостей.
SELECT
    p.code AS permission_code,
    req.code AS requires_code
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.category = 'portal'
   OR req.category = 'portal'
ORDER BY p.sort_order, req.sort_order;

-- Ожидаем 10 строк, is_locked_core = 1 ровно у двух.
SELECT
    p.code,
    rp.is_locked_core
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'CLIENT_PORTAL'
ORDER BY p.sort_order;

-- Ожидаем 0: права портала не должны быть выданы никакой другой роли.
SELECT
    r.code AS role_code,
    COUNT(*) AS portal_permissions
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.category = 'portal'
  AND r.code <> 'CLIENT_PORTAL'
GROUP BY r.code;

-- Ожидаем 0: кольца среди зависимостей портала.
SELECT
    a.permission_id,
    a.required_permission_id
FROM permission_dependencies a
INNER JOIN permission_dependencies b
    ON b.permission_id = a.required_permission_id
   AND b.required_permission_id = a.permission_id
INNER JOIN permissions p ON p.id = a.permission_id
WHERE p.category = 'portal';

-- ----------------------------------------------------------------------------
-- Откат права на просмотр стоимости, если решите, что по умолчанию не нужно.
-- Раскомментировать и выполнить.
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN roles r ON r.id = rp.role_id
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE r.code = 'CLIENT_PORTAL'
--   AND p.code = 'portal.prices.view';