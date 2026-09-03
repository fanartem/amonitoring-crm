-- ============================================================================
-- Этап 3. Фундамент клиентского портала. Часть 1: пользователи и роль.
--
-- Что делает:
--   1. users.user_kind      — сотрудник или клиент;
--   2. users.client_id      — к какому клиенту привязана учётка портала;
--   3. CHECK               — клиентская учётка обязана иметь client_id,
--                            сотрудник обязан его не иметь;
--   4. roles.data_scope    — добавлено значение CLIENT;
--   5. роль CLIENT_PORTAL  — не исполнитель, не ответственный,
--                            самостоятельная регистрация запрещена.
--
-- Права портала и их выдача роли — во второй части миграции.
-- До неё роль существует, но ничего не открывает: это безопасно,
-- потому что requests.py не знает области CLIENT и вернёт NONE.
--
-- ВАЖНО про enum data_scope: значение CLIENT добавляется В КОНЕЦ списка.
-- MySQL хранит enum по порядковому номеру, поэтому переставлять или
-- вставлять в середину нельзя — сломаются существующие строки.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Часть 1.1. Проверка до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем: колонок user_kind и client_id ещё нет, роли CLIENT_PORTAL нет.
SELECT
    SUM(COLUMN_NAME = 'user_kind') AS has_user_kind,
    SUM(COLUMN_NAME = 'client_id') AS has_client_id
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users';

SELECT COUNT(*) AS client_portal_role_exists
FROM roles
WHERE code = 'CLIENT_PORTAL';

-- ----------------------------------------------------------------------------
-- Часть 1.2. Колонки в users
-- ----------------------------------------------------------------------------

ALTER TABLE users
    ADD COLUMN user_kind ENUM('EMPLOYEE', 'CLIENT') NOT NULL DEFAULT 'EMPLOYEE'
        AFTER role,
    ADD COLUMN client_id INT NULL
        AFTER user_kind;

-- Все существующие учётки — сотрудники. DEFAULT это уже сделал,
-- но пишем явно, чтобы миграция была самодостаточной.
UPDATE users
SET user_kind = 'EMPLOYEE',
    client_id = NULL
WHERE user_kind IS NULL
   OR user_kind = '';

-- ----------------------------------------------------------------------------
-- Часть 1.3. Индексы, внешний ключ и правило целостности
-- ----------------------------------------------------------------------------

ALTER TABLE users
    ADD KEY idx_users_user_kind (user_kind),
    ADD KEY idx_users_client (client_id);

-- RESTRICT, а не CASCADE: клиента у нас удаляют мягко (is_deleted),
-- физическое удаление строки с живыми учётками портала должно падать.
ALTER TABLE users
    ADD CONSTRAINT fk_users_client
        FOREIGN KEY (client_id) REFERENCES clients (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Клиентская учётка без клиента бессмысленна и опасна: область данных
-- CLIENT считается от client_id. Сотрудник с client_id — тоже ошибка.
ALTER TABLE users
    ADD CONSTRAINT chk_users_client_kind
        CHECK (
            (user_kind = 'CLIENT' AND client_id IS NOT NULL)
            OR
            (user_kind = 'EMPLOYEE' AND client_id IS NULL)
        );

-- ----------------------------------------------------------------------------
-- Часть 1.4. Новая область данных CLIENT
-- ----------------------------------------------------------------------------

ALTER TABLE roles
    MODIFY COLUMN data_scope
        ENUM(
            'ALL',
            'CITY',
            'RESPONSIBLE_CLIENTS',
            'ASSIGNED',
            'CITY_ASSIGNED',
            'OWN',
            'NONE',
            'CLIENT'
        ) NOT NULL DEFAULT 'NONE';

-- ----------------------------------------------------------------------------
-- Часть 1.5. Роль портала
-- ----------------------------------------------------------------------------

-- is_system = 1, чтобы роль нельзя было удалить из Settings по неосторожности.
-- can_self_register = 0: клиент не должен появляться через публичную форму
-- регистрации. Дополнительно это же запретит auth.py на этапе 5.
INSERT INTO roles (
    code,
    name,
    description,
    badge_color,
    data_scope,
    is_system,
    is_active,
    can_be_request_executor,
    can_be_responsible_manager,
    can_self_register,
    sort_order
)
VALUES (
    'CLIENT_PORTAL',
    'Клиент (портал)',
    'Учётная запись клиента для личного кабинета. Не сотрудник компании.',
    '#0F766E',
    'CLIENT',
    1,
    1,
    0,
    0,
    0,
    900
)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    badge_color = VALUES(badge_color),
    data_scope = VALUES(data_scope),
    is_system = 1,
    is_active = 1,
    can_be_request_executor = 0,
    can_be_responsible_manager = 0,
    can_self_register = 0,
    sort_order = VALUES(sort_order);

-- ----------------------------------------------------------------------------
-- Часть 1.6. Проверка после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем: все существующие пользователи остались сотрудниками,
-- клиентских учёток пока ноль.
SELECT
    user_kind,
    COUNT(*) AS users_count,
    SUM(client_id IS NOT NULL) AS with_client_id
FROM users
GROUP BY user_kind;

-- Ожидаем одну строку: CLIENT_PORTAL / CLIENT / 0 / 0 / 0.
SELECT
    code,
    data_scope,
    is_system,
    is_active,
    can_be_request_executor,
    can_be_responsible_manager,
    can_self_register
FROM roles
WHERE code = 'CLIENT_PORTAL';

-- Ожидаем: CLIENT есть в списке значений enum.
SELECT COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'roles'
  AND COLUMN_NAME = 'data_scope';

-- Ожидаем: ошибка «Check constraint 'chk_users_client_kind' is violated».
-- Раскомментируйте, если хотите убедиться, что правило работает.
-- UPDATE users SET user_kind = 'CLIENT' WHERE id = (SELECT MIN(id) FROM (SELECT id FROM users) t);