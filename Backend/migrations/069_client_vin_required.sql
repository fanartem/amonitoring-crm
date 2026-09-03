-- ============================================================================
-- Настраиваемая обязательность VIN.
--
-- Задача: у клиентов вроде ФортеБанка VIN на момент создания заявки
-- физически неизвестен — машину показывает поставщик уже монтажнику
-- на месте. При этом отменять требование VIN в системе нельзя: на нём
-- держатся проверка дублей, история VIN и связь оборудования с машиной.
--
-- Решение: VIN не становится необязательным, он становится обязательным
-- ПОЗЖЕ — к моменту завершения работ, когда монтажник стоит у машины
-- и видит VIN на стекле. До этого момента vehicles.vin остаётся пустым.
--
-- Почему пустой, а не «временный» VIN из названия клиента: уникальность
-- в vehicles висит на вычисляемой колонке active_vin, которая равна NULL
-- при пустом VIN. Пустых может быть сколько угодно, а любая подставная
-- строка попала бы в уникальный индекс и на второй заявке дала бы 1062.
-- Таблицу vehicles эта миграция не трогает вообще — она уже готова.
--
-- Про предупреждения: VALUES() внутри ON DUPLICATE KEY UPDATE в MySQL 8.0.20+
-- помечена как устаревшая, поэтому запросы вернут несколько warnings.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Часть 1. Проверки до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 0: колонки ещё нет.
SELECT COUNT(*) AS column_exists_before
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'client_installation_settings'
  AND COLUMN_NAME = 'vin_required';

-- Ожидаем 0: права ещё нет.
SELECT COUNT(*) AS permission_exists_before
FROM permissions
WHERE code = 'vehicles.vin.fill';

-- Справочно: как называется категория прав по машинам и какой там
-- максимальный sort_order. Значения подставятся автоматически ниже.
SELECT code, name, category, sort_order
FROM permissions
WHERE code LIKE 'vehicles.%'
ORDER BY sort_order;


-- ----------------------------------------------------------------------------
-- Часть 2. Колонка «VIN обязателен»
--
-- DEFAULT 1: все существующие клиенты продолжают работать как раньше,
-- галочку снимают точечно и осознанно.
-- ----------------------------------------------------------------------------

ALTER TABLE client_installation_settings
    ADD COLUMN vin_required TINYINT NOT NULL DEFAULT 1
        COMMENT 'VIN обязателен при создании заявки. 0 — можно создать без VIN, но завершить работы без него нельзя';


-- ----------------------------------------------------------------------------
-- Часть 3. Право «указать недостающий VIN»
--
-- Отдельное узкое право, а не vehicles.manage: монтажнику нужно вписать
-- ОДИН пустой VIN по СВОЕЙ заявке. Перебивать уже указанный VIN он
-- по-прежнему не может — это остаётся у vehicles.manage. Сами проверки
-- «пустой» и «своя заявка» живут в коде, право открывает только
-- саму возможность.
--
-- Категорию и порядок берём от существующих прав по машинам, чтобы
-- новое право встало в чек-листе рядом со своими, а не в конце списка.
-- ----------------------------------------------------------------------------

SET @vehicles_category = (
    SELECT category
    FROM permissions
    WHERE code LIKE 'vehicles.%'
      AND category IS NOT NULL
    ORDER BY sort_order
    LIMIT 1
);

SET @vehicles_category = COALESCE(@vehicles_category, 'vehicles');

SET @vehicles_sort = (
    SELECT COALESCE(MAX(sort_order), 0) + 5
    FROM permissions
    WHERE category = @vehicles_category
);

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
    'vehicles.vin.fill',
    'Машины: указать недостающий VIN',
    'Позволяет вписать VIN машине, у которой он не указан, в рамках своей заявки. Изменить уже указанный VIN этим правом нельзя.',
    @vehicles_category, 0, 1, 1, @vehicles_sort
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
-- Часть 4. Выдача ролям
--
-- Монтажники и старшие монтажники — те, кто стоит у машины.
-- Тех. поддержка — запасной путь, когда монтажник не смог на месте.
-- Админ, РОП и менеджер — чтобы закрыть за них.
--
-- is_locked_core = 0: право снимается индивидуально.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
INNER JOIN permissions p ON p.code = 'vehicles.vin.fill'
WHERE r.code IN (
        'ADMIN',
        'ROP',
        'MANAGER',
        'TECH_SUPPORT',
        'SENIOR_TECHNICIAN',
        'TECHNICIAN'
    )
  AND p.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);


-- ----------------------------------------------------------------------------
-- Часть 5. Проверки после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем одну строку: tinyint, NO, значение по умолчанию 1.
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'client_installation_settings'
  AND COLUMN_NAME = 'vin_required';

-- Ожидаем 0: ни у одного клиента требование VIN не должно пропасть
-- само по себе при добавлении колонки.
SELECT COUNT(*) AS clients_without_vin_requirement
FROM client_installation_settings
WHERE vin_required = 0;

-- Ожидаем одну строку с кодом vehicles.vin.fill.
SELECT code, name, category, sort_order, is_active
FROM permissions
WHERE code = 'vehicles.vin.fill';

-- Ожидаем шесть ролей из списка выше.
SELECT r.code AS role_code
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'vehicles.vin.fill'
ORDER BY r.code;

-- Ожидаем 0: клиентской роли право по машинам не выдаётся.
SELECT COUNT(*) AS granted_to_portal
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'vehicles.vin.fill'
  AND r.code = 'CLIENT_PORTAL';


-- ----------------------------------------------------------------------------
-- Откат
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code = 'vehicles.vin.fill';
--
-- DELETE FROM permissions WHERE code = 'vehicles.vin.fill';
--
-- ALTER TABLE client_installation_settings DROP COLUMN vin_required;