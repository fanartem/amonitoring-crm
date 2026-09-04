-- ----------------------------------------------------------------------------
-- Часть 1. Проверки до изменений
--
-- ВАЖНО: первый запрос показывает тип clients.id. ALTER ниже рассчитан
-- на INT. Если увидите BIGINT или UNSIGNED — не выполняйте дальше,
-- пришлите вывод, поправлю определение. Несовпадение типов даст
-- ошибку 3780 на внешнем ключе.
-- ----------------------------------------------------------------------------

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'clients'
  AND COLUMN_NAME = 'id';

-- Для сравнения: как выглядит client_id в уже существующей таблице
-- настроек. Новая колонка должна совпасть с ней один в один.
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'client_installation_settings'
  AND COLUMN_NAME = 'client_id';

-- Ожидаем 0: таблицы ещё нет.
SELECT COUNT(*) AS table_exists_before
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'client_portal_branding';

-- Ожидаем 0: права ещё нет.
SELECT COUNT(*) AS permission_exists_before
FROM permissions
WHERE code = 'clients.branding.manage';


-- ----------------------------------------------------------------------------
-- Часть 2. Таблица
--
-- client_id — первичный ключ: у клиента ровно один брендинг, и вторая
-- строка означала бы вопрос «какая из них настоящая».
--
-- is_enabled отдельно от наличия строки: выключить брендинг на время
-- (спор о логотипе, ребрендинг у клиента) нужно, не теряя настроенное.
--
-- logo_version растёт при каждой замене файла и уходит в URL запросом.
-- Без него браузер продолжит показывать старый логотип из кэша, а мы
-- будем искать ошибку на сервере.
-- ----------------------------------------------------------------------------

CREATE TABLE client_portal_branding (
    client_id INT NOT NULL
        COMMENT 'Клиент, чей кабинет оформляем. PRIMARY KEY: брендинг у клиента один',

    is_enabled TINYINT NOT NULL DEFAULT 1
        COMMENT 'Выключатель без потери настроек: 0 — кабинет выглядит стандартно',

    base_color CHAR(7) NULL
        COMMENT 'Основной цвет в формате #rrggbb. Всё остальное считается из него на фронте',

    logo_stored_name VARCHAR(255) NULL
        COMMENT 'Имя файла на диске (uuid + расширение). NULL — логотип не загружен',
    logo_original_name VARCHAR(255) NULL
        COMMENT 'Как файл назывался у клиента — показываем в настройках',
    logo_content_type VARCHAR(100) NULL,
    logo_file_size INT NULL,
    logo_version INT NOT NULL DEFAULT 0
        COMMENT 'Счётчик замен файла. Уходит в URL логотипа, чтобы браузер не показывал старый из кэша',

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
        COMMENT 'Сотрудник, менявший брендинг последним',

    PRIMARY KEY (client_id),
    KEY idx_branding_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Оформление кабинета клиента: логотип и основной цвет. Без наследования по дереву — решение Р57(Б)';


-- Внешние ключи отдельными запросами: если один не пройдёт, таблица
-- уже создана, и чинить придётся только его.
ALTER TABLE client_portal_branding
    ADD CONSTRAINT fk_branding_client
        FOREIGN KEY (client_id) REFERENCES clients (id)
        ON DELETE CASCADE;

ALTER TABLE client_portal_branding
    ADD CONSTRAINT fk_branding_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE SET NULL;


-- ----------------------------------------------------------------------------
-- Часть 3. Право
--
-- sort_order считаем от текущего максимума в категории, чтобы не
-- угадывать нумерацию и не встрять между существующими правами.
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
SELECT
    'clients.branding.manage',
    'Клиенты: оформление кабинета',
    'Сотрудник может задать клиенту логотип и основной цвет личного кабинета.',
    'clients', 0, 1, 1,
    s.next_order
FROM (
    SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
    FROM permissions
    WHERE category = 'clients'
) AS s
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    category = VALUES(category),
    is_dangerous = VALUES(is_dangerous),
    is_system = VALUES(is_system),
    is_active = 1;


-- ----------------------------------------------------------------------------
-- Часть 4. Выдача ролям
--
-- Не перечисляем роли руками: выдаём тем, у кого уже есть clients.manage.
-- Список админских ролей у нас менялся, и захардкоженный перечень
-- разошёлся бы с реальностью молча.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT DISTINCT rp.role_id, target.id, 0
FROM role_permissions rp
INNER JOIN permissions source
    ON source.id = rp.permission_id
   AND source.code = 'clients.manage'
INNER JOIN permissions target
    ON target.code = 'clients.branding.manage'
WHERE target.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);


-- ----------------------------------------------------------------------------
-- Часть 5. Проверки после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем структуру из части 2.
SHOW CREATE TABLE client_portal_branding;

-- Ожидаем 0 строк: настроек ни у кого пока нет.
SELECT COUNT(*) AS branding_rows
FROM client_portal_branding;

-- Ожидаем одну строку с новым правом.
SELECT code, name, category, sort_order, is_active
FROM permissions
WHERE code = 'clients.branding.manage';

-- Ожидаем те же роли, что и у clients.manage.
SELECT r.code AS role_code
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'clients.branding.manage'
ORDER BY r.code;

-- Ожидаем 0: право сотрудника не должно попасть роли кабинета.
SELECT COUNT(*) AS granted_to_portal_role
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'clients.branding.manage'
  AND r.code = 'CLIENT_PORTAL';


-- ----------------------------------------------------------------------------
-- Откат
--
-- Файлы логотипов в uploads/branding/ таблица за собой не уносит —
-- удалять их отдельно, вручную.
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code = 'clients.branding.manage';
--
-- DELETE FROM permissions WHERE code = 'clients.branding.manage';
--
-- DROP TABLE client_portal_branding;