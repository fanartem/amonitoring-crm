-- =====================================================================
-- Т4. Приведение collation к одному значению: utf8mb4_0900_ai_ci
--
-- ЧТО ЗА ОШИБКА
--
-- Collation — правило сравнения строк. У MySQL их несколько, и две
-- строковые колонки с разными правилами сравнивать напрямую нельзя:
-- сервер не знает, чьим правилом пользоваться, и падает с
--
--     (1267) Illegal mix of collations
--
-- Именно это мы поймали на шаге 317: запрос
--
--     JOIN auth_attempts a ON a.email = u.email
--
-- упал, потому что users.email — utf8mb4_0900_ai_ci, а
-- auth_attempts.email — utf8mb4_unicode_ci. Тогда мы залечили
-- симптом: дописали COLLATE с обеих сторон конкретного сравнения.
-- Причина осталась. Следующий join между этими таблицами упадёт
-- точно так же, и упадёт он в проде, а не в тестах — потому что
-- на пустой таблице JOIN не выполняется и ошибка не всплывает.
--
-- ОТКУДА РАСХОЖДЕНИЕ. Часть таблиц создавалась с явным
-- COLLATE utf8mb4_unicode_ci (это правило по умолчанию в MySQL 5.7),
-- а часть — без указания, и получила серверный дефолт MySQL 8
-- utf8mb4_0900_ai_ci. Смешение видно по вашему запросу №2.
--
-- ЧТО ДЕЛАЕМ. Переводим отставшие таблицы на utf8mb4_0900_ai_ci —
-- то есть на то, что уже стоит у users, clients и access_audit_log.
-- Кодировка не меняется (utf8mb4 в обоих случаях), меняется только
-- правило сравнения, поэтому данные не перекодируются и не портятся.
--
-- РИСК. Единственный реальный — уникальный индекс. Два правила
-- по-разному считают некоторые символы одинаковыми, и строки,
-- которые раньше были различны, после конвертации могут стать
-- дублями. В наших колонках это латиница, кириллица и цифры
-- (VIN, email, коды, названия), для них правила совпадают.
-- Если ALTER всё же упадёт с ошибкой 1062 — остановитесь и пришлите
-- текст ошибки, разберём конкретную колонку.
--
-- ОБЪЁМ. auth_attempts — 50 строк, client_history — 21.
-- Остальные таблицы того же порядка. ALTER пройдёт мгновенно,
-- окно обслуживания не нужно.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ПЕРЕД ПРИМЕНЕНИЕМ. Размер конвертируемых таблиц — на случай,
--    если vehicle_equipment или vehicle_vin_links успели вырасти.
--    Если где-то счёт пойдёт на сотни тысяч — скажите, применим
--    к этой таблице отдельно и в спокойное время.
-- ---------------------------------------------------------------------
SELECT TABLE_NAME, TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'auth_attempts',
      'client_history',
      'client_installation_sensors',
      'client_installation_settings',
      'vehicle_equipment',
      'vehicle_vin_links'
  );


-- ---------------------------------------------------------------------
-- 2. ПЕРЕД ПРИМЕНЕНИЕМ. Ожидаем 18 — столько колонок с чужим
--    правилом сравнения вы нашли запросом №2.
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS mismatched_columns_before
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLLATION_NAME IS NOT NULL
  AND COLLATION_NAME <> 'utf8mb4_0900_ai_ci';


-- ---------------------------------------------------------------------
-- 3. Конвертация.
--
--    CONVERT TO CHARACTER SET меняет и правило по умолчанию у таблицы,
--    и правило у каждой строковой колонки — включая те, где COLLATE
--    был прописан явно. Поэтому по колонкам отдельно не ходим.
-- ---------------------------------------------------------------------

ALTER TABLE auth_attempts
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE client_history
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE client_installation_sensors
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE client_installation_settings
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE vehicle_equipment
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE vehicle_vin_links
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;


-- ---------------------------------------------------------------------
-- 4. ПРОВЕРКА. Ожидаем 0 строк: во всей базе не осталось колонок
--    с чужим правилом сравнения.
--
--    Если строки всё же вернулись — это таблицы, которых не было
--    в вашем запросе №2 (например созданные позже). Пришлите вывод,
--    допишу их в миграцию.
-- ---------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLLATION_NAME IS NOT NULL
  AND COLLATION_NAME <> 'utf8mb4_0900_ai_ci'
ORDER BY TABLE_NAME, ORDINAL_POSITION;


-- ---------------------------------------------------------------------
-- 5. ПРОВЕРКА. Ожидаем utf8mb4_0900_ai_ci у всех шести таблиц.
-- ---------------------------------------------------------------------
SELECT TABLE_NAME, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'auth_attempts',
      'client_history',
      'client_installation_sensors',
      'client_installation_settings',
      'vehicle_equipment',
      'vehicle_vin_links'
  );


-- ---------------------------------------------------------------------
-- 6. ПРОВЕРКА. Тот самый join, который падал на шаге 317 — теперь
--    без единого COLLATE. Ожидаем: запрос выполняется без ошибки.
--    Сколько строк вернётся, неважно.
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS joined_rows
FROM auth_attempts a
JOIN users u ON a.email = u.email
WHERE a.is_success = 1;