-- ============================================================================
-- Права кабинета клиента на файлы заявки.
--
-- Зачем: клиент прикрепляет к заявке акт, доверенность, фото объекта —
-- сейчас он этого сделать не может и присылает файлы менеджеру в мессенджер,
-- откуда они не доезжают до заявки.
--
-- Почему отдельная пара кодов, а не общий с сотрудниками attachments.view
-- (решение Р54(А)): коды выглядят одинаково, но означают разное. Сотруднику
-- attachments.view открывает файлы всех карточек, до которых дотягивается
-- его область данных; клиенту нужно ровно одно — файлы своих заявок. Слив
-- их в один код, мы не смогли бы закрыть файлы одному клиенту, не задев
-- сотрудников, и наоборот.
--
-- Что эти права НЕ открывают: файлы карточки клиента. Доступ к сущности
-- CLIENT проверяется по кодам clients.attachments.* / clients.view_*,
-- которых у роли CLIENT_PORTAL нет, поэтому карточка остаётся закрытой
-- без отдельного запрета.
--
-- Внутренние файлы (is_internal = 1) клиенту не видны ни при каких правах —
-- это проверяется в attachments.py до проверки прав.
--
-- Про предупреждения: VALUES() внутри ON DUPLICATE KEY UPDATE в MySQL 8.0.20+
-- помечена как устаревшая, поэтому запросы вернут несколько warnings.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Часть 1. Проверки до изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 0: кодов ещё нет.
SELECT COUNT(*) AS existing_portal_attachments
FROM permissions
WHERE code IN ('portal.attachments.view', 'portal.attachments.upload');

-- Ожидаем 12: десять прав основания, portal.comments.create (45)
-- и portal.vehicles.create (55).
SELECT COUNT(*) AS portal_permissions_before
FROM permissions
WHERE category = 'portal';

-- Ожидаем одну строку: роль кабинета существует.
SELECT id, code, name
FROM roles
WHERE code = 'CLIENT_PORTAL';


-- ----------------------------------------------------------------------------
-- Часть 2. Права
--
-- sort_order 46 и 47: сразу после «комментариев» (45) и до «просмотра
-- своих машин» (50). Файлы заявки — соседи комментариев по смыслу:
-- и то и другое клиент добавляет к уже созданной заявке.
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
        'portal.attachments.view',
        'Портал: просмотр файлов заявки',
        'Клиент видит и скачивает файлы своих заявок. Внутренние файлы остаются скрытыми.',
        'portal', 0, 1, 1, 46
    ),
    (
        'portal.attachments.upload',
        'Портал: загрузка файлов заявки',
        'Клиент прикрепляет файлы к заявке — при создании и после неё. Загруженный файл не может быть помечен внутренним.',
        'portal', 0, 1, 1, 47
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
-- Файлы живут внутри заявки: не видя заявок, клиент не доберётся до их
-- файлов физически, и право без portal.requests.view выглядело бы
-- выданным, ничего при этом не давая.
--
-- Загрузка требует просмотра по той же причине, что и у машин: человек,
-- не видящий списка, загрузит один и тот же акт трижды.
-- ----------------------------------------------------------------------------

INSERT IGNORE INTO permission_dependencies (permission_id, required_permission_id)
SELECT p.id, req.id
FROM permissions p
INNER JOIN permissions req
    ON (p.code = 'portal.attachments.view'   AND req.code = 'portal.requests.view')
    OR (p.code = 'portal.attachments.upload' AND req.code = 'portal.attachments.view')
WHERE p.is_active = 1
  AND req.is_active = 1;


-- ----------------------------------------------------------------------------
-- Часть 4. Выдача роли CLIENT_PORTAL
--
-- is_locked_core = 0: оба права должны сниматься индивидуально —
-- есть клиенты, от которых файлы нам не нужны.
-- ----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_id, is_locked_core)
SELECT r.id, p.id, 0
FROM roles r
INNER JOIN permissions p
    ON p.code IN ('portal.attachments.view', 'portal.attachments.upload')
WHERE r.code = 'CLIENT_PORTAL'
  AND p.is_active = 1
ON DUPLICATE KEY UPDATE
    is_locked_core = VALUES(is_locked_core);


-- ----------------------------------------------------------------------------
-- Часть 5. Проверки после изменений
-- ----------------------------------------------------------------------------

-- Ожидаем 14 строк; между portal.comments.create (45)
-- и portal.vehicles.view (50) стоят два новых кода.
SELECT code, name, sort_order, is_active
FROM permissions
WHERE category = 'portal'
ORDER BY sort_order;

-- Ожидаем две строки:
--   portal.attachments.view   -> portal.requests.view
--   portal.attachments.upload -> portal.attachments.view
SELECT
    p.code AS permission_code,
    req.code AS requires_code
FROM permission_dependencies pd
INNER JOIN permissions p ON p.id = pd.permission_id
INNER JOIN permissions req ON req.id = pd.required_permission_id
WHERE p.code IN ('portal.attachments.view', 'portal.attachments.upload')
ORDER BY p.code;

-- Ожидаем одну строку: CLIENT_PORTAL с 14 портальными правами.
SELECT
    r.code AS role_code,
    COUNT(*) AS portal_permissions
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.category = 'portal'
GROUP BY r.code;

-- Ожидаем 0: права кабинета не должны попасть роли сотрудника.
SELECT COUNT(*) AS granted_to_employee_roles
FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('portal.attachments.view', 'portal.attachments.upload')
  AND r.code <> 'CLIENT_PORTAL';

-- Ожидаем 0: индивидуальных запретов на новые права ещё быть не может.
SELECT COUNT(*) AS overrides_exist
FROM user_permission_overrides upo
INNER JOIN permissions p ON p.id = upo.permission_id
WHERE p.code IN ('portal.attachments.view', 'portal.attachments.upload');


-- ----------------------------------------------------------------------------
-- Откат
-- ----------------------------------------------------------------------------

-- DELETE rp
-- FROM role_permissions rp
-- INNER JOIN permissions p ON p.id = rp.permission_id
-- WHERE p.code IN ('portal.attachments.view', 'portal.attachments.upload');
--
-- DELETE pd
-- FROM permission_dependencies pd
-- INNER JOIN permissions p ON p.id = pd.permission_id
-- WHERE p.code IN ('portal.attachments.view', 'portal.attachments.upload');
--
-- DELETE FROM permissions
-- WHERE code IN ('portal.attachments.view', 'portal.attachments.upload');