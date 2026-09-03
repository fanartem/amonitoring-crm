-- ============================================================================
-- Этап 6. Право «Портал: комментарий к заявке».
--
-- Зачем: по решению Р8 комментарии заявки общие и не скрытые — это место
-- связи между клиентом и менеджером. Читать их клиент уже может (область
-- данных CLIENT, шаг 322), а писать было нечем: кода портала для этого
-- не существовало, а requests.comments.create клиенту не выдаётся.
--
-- Отдельное право, а не расширение portal.requests.view: возможность
-- писать в карточку заявки должна отключаться независимо от просмотра.
--
-- Про предупреждения: VALUES() внутри ON DUPLICATE KEY UPDATE в MySQL 8.0.20+
-- помечена как устаревшая, поэтому запросы вернут несколько warnings.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Часть 1. Проверка до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 0.
SELECT COUNT(*) AS existing_portal_comment_permission
FROM permissions
WHERE code = 'portal.comments.create';

-- Ожидаем 10: столько прав портала завела миграция части 2 этапа 3.
SELECT COUNT(*) AS portal_permissions_before
FROM permissions
WHERE category = 'portal';

-- ----------------------------------------------------------------------------
-- Часть 2. Право
--
-- sort_order 45: сразу после «отмены новой заявки» (40), до «просмотра
-- своих машин» (50). Порядок в чек-листе идёт по этому полю.
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
VALUES (
    'portal.comments.create',
    'Портал: комментарий к заявке',
    'Клиент может писать комментарии в своей заявке. Комментарии видят и клиент, и сотрудники.',
    'portal', 0, 1, 1, 45
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
-- Часть 3. Зависимость
--
-- Писать в заявку, не видя её, бессмысленно.
-- ----------------------------------------------------------------------------

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON p.code = 'portal.comments.create'
   AND req.code = 'portal.requests.view'
WHERE p.is_active = 1
  AND req.is_active = 1;

-- ----------------------------------------------------------------------------
-- Часть 4. Выдача роли CLIENT_PORTAL
--
-- is_locked_core = 0: право должно сниматься индивидуально. Клиента,
-- который пишет в заявках лишнее, можно закрыть, не трогая остальных.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
INNER JOIN permissions p ON p.code = 'portal.comments.create'
WHERE r.code = 'CLIENT_PORTAL'
  AND p.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);

-- ----------------------------------------------------------------------------
-- Часть 5. Проверка после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 11 строк, среди них portal.comments.create с sort_order 45.
SELECT code, name, sort_order, is_active
FROM permissions
WHERE category = 'portal'
ORDER BY sort_order;

-- Ожидаем одну строку: portal.comments.create -> portal.requests.view.
SELECT
    p.code AS permission_code,
    req.code AS requires_code
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code = 'portal.comments.create';

-- Ожидаем 11 строк и только роль CLIENT_PORTAL.
SELECT
    r.code AS role_code,
    COUNT(*) AS portal_permissions
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.category = 'portal'
GROUP BY r.code;

-- Ожидаем 0: право портала не должно быть выдано роли сотрудника.
SELECT COUNT(*) AS granted_to_employee_roles
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'portal.comments.create'
  AND r.code <> 'CLIENT_PORTAL';

-- ----------------------------------------------------------------------------
-- Откат
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code = 'portal.comments.create';
--
-- DELETE pd
-- FROM permission_dependencies pd
-- INNER JOIN permissions p ON p.id = pd.permission_id
-- WHERE p.code = 'portal.comments.create';
--
-- DELETE FROM permissions WHERE code = 'portal.comments.create';