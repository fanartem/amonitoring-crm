-- ============================================================================
-- Этап 5. Выдача доступа в клиентский портал: права на управление
-- учётными записями клиента.
--
-- Что делает:
--   1. добавляет 2 права в категорию clients;
--   2. проставляет зависимости;
--   3. выдаёт оба права роли ADMIN.
--
-- Чего НЕ делает и почему:
--   - не добавляет must_change_password: по решению Р11 обязательная смена
--     пароля не нужна. Пользователь может сменить пароль сам, админ может
--     поставить новый — как у обычных сотрудников;
--   - не трогает users: одна учётка на клиента или несколько (решение Р12 —
--     несколько) регулируется отсутствием UNIQUE на users.client_id,
--     которого мы и не заводили;
--   - не заводит отдельный журнал: изменения пишем в client_history
--     (функция add_client_history) и access_audit_log.
--
-- Про предупреждения: VALUES() внутри ON DUPLICATE KEY UPDATE в MySQL 8.0.20+
-- помечена как устаревшая, поэтому будут warnings. Это ожидаемо.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Часть 1. Проверка до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 0: этих кодов ещё нет.
SELECT COUNT(*) AS existing_portal_user_permissions
FROM permissions
WHERE code IN ('clients.portal_users.view', 'clients.portal_users.manage');

-- Справочно: что уже есть в категории clients и с какими sort_order.
-- Нужно, чтобы убедиться, что код clients.view существует — на него
-- вешается зависимость ниже. Если его нет, зависимость просто не создастся,
-- ошибки не будет, но проверка в части 5 покажет 1 строку вместо 2.
SELECT code, name, sort_order, is_active
FROM permissions
WHERE category = 'clients'
ORDER BY sort_order, code;

-- Ожидаем 1: роль администратора на месте.
SELECT COUNT(*) AS admin_role_exists
FROM roles
WHERE code = 'ADMIN';

-- ----------------------------------------------------------------------------
-- Часть 2. Права
--
-- view   — видеть вкладку «Доступ в портал» в карточке клиента и список
--          заведённых учёток. Пароли нигде не показываются.
-- manage — создать учётку, включить/отключить, задать новый пароль,
--          изменить набор прав портала у конкретной учётки.
--
-- is_dangerous = 1 у manage: право фактически выдаёт доступ в систему
-- внешнему человеку. В Settings оно должно выделяться.
--
-- is_system = 0: это обычные права раздела «Клиенты», их можно
-- переназначать и отключать из Settings, как и остальные clients.*.
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
        'clients.portal_users.view',
        'Учётные записи портала: просмотр',
        'Список учётных записей клиента для личного кабинета. Пароли не показываются.',
        'clients', 0, 0, 1, 700
    ),
    (
        'clients.portal_users.manage',
        'Учётные записи портала: управление',
        'Создание учётной записи клиента, включение и отключение, установка нового пароля, настройка прав портала.',
        'clients', 1, 0, 1, 710
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
-- Часть 3. Зависимости
--
-- Направление прежнее: «имеешь permission_id → автоматически получаешь
-- required». required всегда уже по смыслу.
--
--   manage → view      : управлять, не видя списка, бессмысленно;
--   view   → clients.view : учётки живут в карточке клиента, без доступа
--                           к разделу «Клиенты» вкладку негде показать.
--
-- Вторая строка вставится только если код clients.view существует.
-- ----------------------------------------------------------------------------

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON (p.code = 'clients.portal_users.manage' AND req.code = 'clients.portal_users.view')
    OR (p.code = 'clients.portal_users.view'   AND req.code = 'clients.view')
WHERE p.is_active = 1
  AND req.is_active = 1;

-- ----------------------------------------------------------------------------
-- Часть 4. Выдача роли ADMIN
--
-- is_locked_core = 0: индивидуальный DENY на конкретного администратора
-- должен работать. Право чувствительное, возможность точечно закрыть его
-- нужнее, чем гарантия, что оно есть у всех админов.
--
-- Супер-админы получают все активные права автоматически
-- (get_effective_permissions), эта выдача — для обычных администраторов.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
INNER JOIN permissions p
    ON p.code IN ('clients.portal_users.view', 'clients.portal_users.manage')
WHERE r.code = 'ADMIN'
  AND p.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);

-- ----------------------------------------------------------------------------
-- Часть 5. Проверка после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 2 строки.
SELECT code, name, category, is_dangerous, is_system, is_active, sort_order
FROM permissions
WHERE code IN ('clients.portal_users.view', 'clients.portal_users.manage')
ORDER BY sort_order;

-- Ожидаем 2 строки:
--   clients.portal_users.manage -> clients.portal_users.view
--   clients.portal_users.view   -> clients.view
-- Если строк 1 — значит кода clients.view в каталоге нет, напишите мне,
-- подберём другой родительский код.
SELECT
    p.code AS permission_code,
    req.code AS requires_code
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code IN ('clients.portal_users.view', 'clients.portal_users.manage')
ORDER BY p.sort_order;

-- Ожидаем ровно 2 строки и только роль ADMIN.
SELECT
    r.code AS role_code,
    p.code AS permission_code,
    rp.is_locked_core
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('clients.portal_users.view', 'clients.portal_users.manage')
ORDER BY r.code, p.sort_order;

-- Ожидаем 0: роль портала не должна получить право заводить учётки.
SELECT COUNT(*) AS portal_role_got_manage
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'CLIENT_PORTAL'
  AND p.code IN ('clients.portal_users.view', 'clients.portal_users.manage');

-- ----------------------------------------------------------------------------
-- Откат
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code IN ('clients.portal_users.view', 'clients.portal_users.manage');
--
-- DELETE pd
-- FROM permission_dependencies pd
-- INNER JOIN permissions p ON p.id = pd.permission_id
-- WHERE p.code IN ('clients.portal_users.view', 'clients.portal_users.manage');
--
-- DELETE FROM permissions
-- WHERE code IN ('clients.portal_users.view', 'clients.portal_users.manage');