-- ============================================================
-- Миграция: очистка дублей машин JET-FINANCE после импорта GlonassSoft
-- Тип: data cleanup / soft delete
-- ВАЖНО:
--   - Физически машины НЕ удаляются.
--   - Ставится is_deleted = 1.
--   - Старые заявки и оборудование не трогаются.
--   - Скрипт рассчитан на JET-FINANCE client_id = 489.
--   - Скрипт должен удалить 2424 дубля.
-- ============================================================


-- ============================================================
-- 0. Настройки
-- ============================================================

SET @target_client_id = 489;
SET @target_company_name = 'JET-FINANCE';

-- Ожидаемое количество кандидатов на удаление.
-- Если на сервере число отличается, скрипт НЕ выполнит UPDATE.
SET @expected_candidates_to_delete = 2424;

-- По локальной проверке заблокированных дублей быть не должно.
SET @expected_blocked_by_requests_or_equipment = 0;

-- Включатель выполнения.
-- 1 = выполнять UPDATE
-- 0 = только подготовить проверки, UPDATE ничего не изменит
SET @do_cleanup = 1;

-- Кто будет указан как deleted_by.
-- Берём первого ADMIN. Если нужно указать конкретного админа,
-- замени на: SET @admin_user_id = 123;
SET @admin_user_id = (
    SELECT id
    FROM users
    WHERE role = 'ADMIN'
    ORDER BY id
    LIMIT 1
);


-- ============================================================
-- 1. Проверка целевого клиента
-- ============================================================

DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_target_client;

CREATE TEMPORARY TABLE tmp_cleanup_target_client AS
SELECT
    id AS client_id,
    name,
    company_name,
    source_client_name,
    source_parent_client_name,
    is_deleted
FROM clients
WHERE id = @target_client_id
  AND is_deleted = 0
  AND (
      company_name = @target_company_name
      OR source_client_name = @target_company_name
      OR name = @target_company_name
  );

SELECT
    '-- 1. Проверка целевого клиента. Должна быть ровно 1 строка' AS check_step;

SELECT *
FROM tmp_cleanup_target_client;

SELECT
    COUNT(*) AS target_client_rows_must_be_1
FROM tmp_cleanup_target_client;


-- ============================================================
-- 2. Подготовка нормализованных машин JET-FINANCE
-- ============================================================

DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_jet_ranked;

CREATE TEMPORARY TABLE tmp_cleanup_jet_ranked AS
WITH normalized_vehicles AS (
    SELECT
        v.id,
        v.client_id,
        v.brand,
        v.model,
        v.plate_number,
        v.vin,
        v.type,

        UPPER(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    TRIM(COALESCE(v.plate_number, '')),
                    '\\s*\\(.*$',
                    ''
                ),
                '[^0-9A-ZА-Я]',
                ''
            )
        ) AS plate_key,

        LOWER(CONCAT_WS(' ', v.brand, v.model, v.plate_number)) AS vehicle_text

    FROM vehicles v
    INNER JOIN tmp_cleanup_target_client tc ON tc.client_id = v.client_id
    WHERE v.is_deleted = 0
      AND v.plate_number IS NOT NULL
      AND TRIM(v.plate_number) != ''
),

vehicle_links AS (
    SELECT
        nv.id,
        COUNT(DISTINCT rv.request_id) AS request_count,
        COUNT(DISTINCT re.id) AS equipment_link_count
    FROM normalized_vehicles nv
    LEFT JOIN request_vehicles rv ON rv.vehicle_id = nv.id
    LEFT JOIN request_equipment re ON re.request_vehicle_id = rv.id
    GROUP BY nv.id
),

duplicate_only AS (
    SELECT
        nv.*,
        COALESCE(vl.request_count, 0) AS request_count,
        COALESCE(vl.equipment_link_count, 0) AS equipment_link_count,
        COUNT(*) OVER (PARTITION BY nv.plate_key) AS group_count,

        CASE
            WHEN nv.vehicle_text REGEXP 'займ|закрыт|изъят|карлот|дтп|в чате|не на ходу|gps|терменирован|терминирован|мошен|ровд|за границей|хард'
            THEN 1 ELSE 0
        END AS bad_label_score

    FROM normalized_vehicles nv
    LEFT JOIN vehicle_links vl ON vl.id = nv.id
    WHERE nv.plate_key != ''
)

SELECT
    d.*,

    ROW_NUMBER() OVER (
        PARTITION BY d.plate_key
        ORDER BY
            -- 1. Сначала оставляем машину, если на ней есть заявки или оборудование
            CASE
                WHEN d.request_count > 0 OR d.equipment_link_count > 0 THEN 0
                ELSE 1
            END,

            -- 2. Потом оставляем нормальное название, а не служебные статусы
            d.bad_label_score ASC,

            -- 3. Потом оставляем запись с настоящим VIN, если он есть
            CASE
                WHEN d.vin IS NOT NULL
                     AND d.vin != ''
                     AND UPPER(d.vin) NOT LIKE 'GS%' THEN 0
                ELSE 1
            END,

            -- 4. Записи со скобками в plate_number хуже
            CASE
                WHEN d.plate_number LIKE '%(%' THEN 1
                ELSE 0
            END,

            -- 5. Если всё одинаково, оставляем самую старую запись
            d.id ASC
    ) AS keep_rank

FROM duplicate_only d
WHERE d.group_count > 1;


-- ============================================================
-- 3. Проверка найденных дублей
-- ============================================================

SELECT
    '-- 3. Общая проверка дублей JET-FINANCE до удаления' AS check_step;

SELECT
    COUNT(DISTINCT plate_key) AS duplicate_plate_groups,
    COUNT(*) AS vehicles_in_duplicate_groups,

    SUM(CASE WHEN keep_rank = 1 THEN 1 ELSE 0 END) AS vehicles_to_keep,
    SUM(CASE WHEN keep_rank > 1 THEN 1 ELSE 0 END) AS potential_duplicates_to_delete,

    SUM(
        CASE
            WHEN keep_rank > 1
             AND request_count = 0
             AND equipment_link_count = 0
            THEN 1 ELSE 0
        END
    ) AS safe_to_delete,

    SUM(
        CASE
            WHEN keep_rank > 1
             AND (request_count > 0 OR equipment_link_count > 0)
            THEN 1 ELSE 0
        END
    ) AS blocked_by_requests_or_equipment

FROM tmp_cleanup_jet_ranked;


-- ============================================================
-- 4. Формирование списка машин на soft delete
-- ============================================================

DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_jet_delete_candidates;

CREATE TEMPORARY TABLE tmp_cleanup_jet_delete_candidates AS
SELECT
    r.id AS vehicle_id,
    r.client_id,
    r.plate_key,
    r.brand,
    r.model,
    r.plate_number,
    r.vin,
    r.request_count,
    r.equipment_link_count,
    r.bad_label_score,

    k.id AS keep_vehicle_id,
    k.brand AS keep_brand,
    k.model AS keep_model,
    k.plate_number AS keep_plate_number,
    k.vin AS keep_vin

FROM tmp_cleanup_jet_ranked r
INNER JOIN tmp_cleanup_jet_ranked k
    ON k.plate_key = r.plate_key
   AND k.keep_rank = 1
WHERE r.keep_rank > 1
  AND r.request_count = 0
  AND r.equipment_link_count = 0;


-- ============================================================
-- 5. Preview кандидатов на удаление
-- ============================================================

SELECT
    '-- 5. Preview первых 100 кандидатов на soft delete' AS check_step;

SELECT
    plate_key,

    keep_vehicle_id,
    keep_brand,
    keep_model,
    keep_plate_number,
    keep_vin,

    vehicle_id AS delete_vehicle_id,
    brand AS delete_brand,
    model AS delete_model,
    plate_number AS delete_plate_number,
    vin AS delete_vin,
    bad_label_score

FROM tmp_cleanup_jet_delete_candidates
ORDER BY
    plate_key,
    vehicle_id
LIMIT 100;


-- ============================================================
-- 6. Контрольные числа перед UPDATE
-- ============================================================

SELECT
    '-- 6. Контрольные числа перед UPDATE' AS check_step;

SELECT
    @admin_user_id AS admin_user_id_must_not_be_null,
    @do_cleanup AS do_cleanup_must_be_1,
    @target_client_id AS target_client_id,
    @expected_candidates_to_delete AS expected_candidates_to_delete,
    @expected_blocked_by_requests_or_equipment AS expected_blocked_by_requests_or_equipment;

SELECT
    COUNT(*) AS actual_candidates_to_delete
FROM tmp_cleanup_jet_delete_candidates;

SELECT
    COUNT(*) AS actual_blocked_by_requests_or_equipment
FROM tmp_cleanup_jet_ranked
WHERE keep_rank > 1
  AND (request_count > 0 OR equipment_link_count > 0);


-- ============================================================
-- 7. Guard-защита
-- Если guard_rows_must_be_1 = 0, UPDATE ниже ничего не изменит.
-- ============================================================

DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_guard;

CREATE TEMPORARY TABLE tmp_cleanup_guard AS
SELECT
    1 AS ok
WHERE @do_cleanup = 1
  AND @admin_user_id IS NOT NULL
  AND (SELECT COUNT(*) FROM tmp_cleanup_target_client) = 1
  AND (SELECT COUNT(*) FROM tmp_cleanup_jet_delete_candidates) = @expected_candidates_to_delete
  AND (
      SELECT COUNT(*)
      FROM tmp_cleanup_jet_ranked
      WHERE keep_rank > 1
        AND (request_count > 0 OR equipment_link_count > 0)
  ) = @expected_blocked_by_requests_or_equipment;

SELECT
    '-- 7. Guard-защита. guard_rows_must_be_1 должен быть 1' AS check_step;

SELECT
    COUNT(*) AS guard_rows_must_be_1
FROM tmp_cleanup_guard;


-- ============================================================
-- 8. Soft delete дублей JET-FINANCE
-- ============================================================

START TRANSACTION;

UPDATE vehicles v
INNER JOIN tmp_cleanup_jet_delete_candidates d ON d.vehicle_id = v.id
INNER JOIN tmp_cleanup_guard g ON g.ok = 1
SET
    v.is_deleted = 1,
    v.deleted_at = NOW(),
    v.deleted_by = @admin_user_id,
    v.delete_reason_type = 'OTHER',
    v.delete_reason = CONCAT(
        'Очистка дублей после импорта GlonassSoft: дубликат машины по госномеру у JET-FINANCE. ',
        'Оставлена машина ID: ',
        d.keep_vehicle_id,
        ', plate_key: ',
        d.plate_key
    )
WHERE v.is_deleted = 0
  AND v.client_id = @target_client_id;

SELECT
    '-- 8. Результат UPDATE. deleted_count должен быть 2424' AS check_step;

SELECT
    ROW_COUNT() AS deleted_count;

SELECT
    COUNT(*) AS remaining_candidates_after_update
FROM tmp_cleanup_jet_delete_candidates d
INNER JOIN vehicles v ON v.id = d.vehicle_id
WHERE v.is_deleted = 0;

COMMIT;


-- ============================================================
-- 9. Проверка после очистки JET-FINANCE
-- ============================================================

SELECT
    '-- 9. Проверка дублей JET-FINANCE после очистки' AS check_step;

WITH normalized_vehicles_after AS (
    SELECT
        v.id,
        v.client_id,

        UPPER(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    TRIM(COALESCE(v.plate_number, '')),
                    '\\s*\\(.*$',
                    ''
                ),
                '[^0-9A-ZА-Я]',
                ''
            )
        ) AS plate_key

    FROM vehicles v
    WHERE v.is_deleted = 0
      AND v.client_id = @target_client_id
      AND v.plate_number IS NOT NULL
      AND TRIM(v.plate_number) != ''
),

duplicate_groups_after AS (
    SELECT
        plate_key,
        COUNT(*) AS vehicle_count
    FROM normalized_vehicles_after
    WHERE plate_key != ''
    GROUP BY plate_key
    HAVING COUNT(*) > 1
)

SELECT
    COUNT(*) AS duplicate_plate_groups_after,
    COALESCE(SUM(vehicle_count), 0) AS vehicles_in_duplicate_groups_after,
    COALESCE(SUM(vehicle_count - 1), 0) AS potential_duplicates_left_after
FROM duplicate_groups_after;


-- ============================================================
-- 10. Проверка последних удалённых машин по JET-FINANCE
-- ============================================================

SELECT
    '-- 10. Последние удалённые машины JET-FINANCE' AS check_step;

SELECT
    id,
    client_id,
    brand,
    model,
    plate_number,
    vin,
    is_deleted,
    deleted_at,
    deleted_by,
    delete_reason_type,
    delete_reason
FROM vehicles
WHERE client_id = @target_client_id
  AND is_deleted = 1
  AND delete_reason LIKE '%JET-FINANCE%'
ORDER BY deleted_at DESC, id DESC
LIMIT 50;


-- ============================================================
-- 11. Очистка временных таблиц
-- ============================================================

DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_guard;
DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_jet_delete_candidates;
DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_jet_ranked;
DROP TEMPORARY TABLE IF EXISTS tmp_cleanup_target_client;

-- Конец миграции