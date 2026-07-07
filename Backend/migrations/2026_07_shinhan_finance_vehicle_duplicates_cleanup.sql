-- ============================================================
-- Migration: Shinhan Finance vehicle duplicates cleanup
-- Date: 2026-07
--
-- Purpose:
--   Soft-delete duplicate vehicles for Shinhan Finance after import from GlonassSoft.
--
-- Logic:
--   - Target client: Shinhan Finance, client_id = 274
--   - Duplicate key: exact TRIM(plate_number)
--   - For each duplicate plate_number, keep one active vehicle.
--   - Prefer keeping a vehicle that has requests/equipment links.
--   - Soft-delete only duplicate vehicles that have:
--       request_count = 0
--       equipment_link_count = 0
--   - Blocked duplicate vehicles are not deleted.
--
-- Expected server pre-check values:
--   duplicate_plate_groups = 1018
--   vehicles_in_duplicate_groups = 2090
--   potential_duplicates_to_delete = 1072
--   safe_to_delete = 1021
--   blocked_by_requests_or_equipment = 51
-- ============================================================

SET @target_client_id = 274;
SET @expected_candidates_to_delete = 1021;
SET @expected_blocked_by_requests_or_equipment = 51;
SET @do_cleanup = 1;

SET @admin_user_id = COALESCE(
    (SELECT id FROM users WHERE id = 1 LIMIT 1),
    (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 1)
);


SELECT '-- 1. Проверка целевого клиента. Должна быть ровно 1 строка' AS check_step;

DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_target_client;

CREATE TEMPORARY TABLE tmp_shinhan_target_client AS
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
        LOWER(COALESCE(name, '')) LIKE '%shinhan%'
     OR LOWER(COALESCE(company_name, '')) LIKE '%shinhan%'
     OR LOWER(COALESCE(source_client_name, '')) LIKE '%shinhan%'
     OR LOWER(COALESCE(source_parent_client_name, '')) LIKE '%shinhan%'
  );

SELECT * FROM tmp_shinhan_target_client;

SELECT COUNT(*) AS target_client_rows_must_be_1
FROM tmp_shinhan_target_client;


SELECT '-- 2. Подготовка ranked-таблицы по дублям Shinhan Finance' AS check_step;

DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_ranked;

CREATE TEMPORARY TABLE tmp_shinhan_ranked AS
SELECT
    v.id,
    v.client_id,
    v.brand,
    v.model,
    TRIM(v.plate_number) AS plate_number,
    v.vin,
    v.year,
    v.type,

    COUNT(DISTINCT rv.request_id) AS request_count,
    COUNT(DISTINCT re.id) AS equipment_link_count,

    ROW_NUMBER() OVER (
        PARTITION BY TRIM(v.plate_number)
        ORDER BY
            CASE
                WHEN COUNT(DISTINCT rv.request_id) > 0
                  OR COUNT(DISTINCT re.id) > 0
                THEN 0
                ELSE 1
            END,
            v.id ASC
    ) AS keep_rank,

    COUNT(*) OVER (
        PARTITION BY TRIM(v.plate_number)
    ) AS group_count

FROM vehicles v
LEFT JOIN request_vehicles rv
    ON rv.vehicle_id = v.id
LEFT JOIN request_equipment re
    ON re.request_vehicle_id = rv.id

WHERE v.client_id = @target_client_id
  AND v.is_deleted = 0
  AND v.plate_number IS NOT NULL
  AND TRIM(v.plate_number) != ''

GROUP BY
    v.id,
    v.client_id,
    v.brand,
    v.model,
    TRIM(v.plate_number),
    v.vin,
    v.year,
    v.type;


SELECT '-- 3. Общая проверка дублей Shinhan Finance до удаления' AS check_step;

SELECT
    COUNT(*) AS duplicate_plate_groups,
    SUM(group_count) AS vehicles_in_duplicate_groups,
    COUNT(*) AS vehicles_to_keep,
    SUM(group_count - 1) AS potential_duplicates_to_delete
FROM (
    SELECT
        plate_number,
        MAX(group_count) AS group_count
    FROM tmp_shinhan_ranked
    WHERE group_count > 1
    GROUP BY plate_number
) duplicate_groups;


SELECT
    COUNT(*) AS potential_duplicates_to_delete,

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

FROM tmp_shinhan_ranked
WHERE group_count > 1
  AND keep_rank > 1;


SELECT '-- 4. Формирование keepers / safe delete candidates / blocked candidates' AS check_step;

DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_keepers;

CREATE TEMPORARY TABLE tmp_shinhan_keepers AS
SELECT
    id AS keep_vehicle_id,
    plate_number,
    brand AS keep_brand,
    model AS keep_model,
    vin AS keep_vin,
    request_count AS keep_request_count,
    equipment_link_count AS keep_equipment_link_count
FROM tmp_shinhan_ranked
WHERE group_count > 1
  AND keep_rank = 1;


DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_delete_candidates_raw;

CREATE TEMPORARY TABLE tmp_shinhan_delete_candidates_raw AS
SELECT
    id AS vehicle_id,
    client_id,
    plate_number,
    brand,
    model,
    vin,
    year,
    type,
    request_count,
    equipment_link_count,
    keep_rank,
    group_count
FROM tmp_shinhan_ranked
WHERE group_count > 1
  AND keep_rank > 1
  AND request_count = 0
  AND equipment_link_count = 0;


DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_blocked_candidates;

CREATE TEMPORARY TABLE tmp_shinhan_blocked_candidates AS
SELECT
    id AS vehicle_id,
    client_id,
    plate_number,
    brand,
    model,
    vin,
    year,
    type,
    request_count,
    equipment_link_count,
    keep_rank,
    group_count
FROM tmp_shinhan_ranked
WHERE group_count > 1
  AND keep_rank > 1
  AND (request_count > 0 OR equipment_link_count > 0);


DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_delete_candidates;

CREATE TEMPORARY TABLE tmp_shinhan_delete_candidates AS
SELECT
    dc.vehicle_id,
    dc.client_id,
    dc.plate_number,
    dc.brand,
    dc.model,
    dc.vin,
    dc.year,
    dc.type,
    dc.request_count,
    dc.equipment_link_count,

    k.keep_vehicle_id,
    k.keep_brand,
    k.keep_model,
    k.keep_vin,
    k.keep_request_count,
    k.keep_equipment_link_count

FROM tmp_shinhan_delete_candidates_raw dc
INNER JOIN tmp_shinhan_keepers k
    ON k.plate_number = dc.plate_number;


SELECT '-- 5. Preview первых 100 safe-кандидатов на soft delete' AS check_step;

SELECT
    plate_number,

    keep_vehicle_id,
    keep_brand,
    keep_model,
    keep_vin,
    keep_request_count,
    keep_equipment_link_count,

    vehicle_id AS delete_vehicle_id,
    brand AS delete_brand,
    model AS delete_model,
    vin AS delete_vin,
    request_count AS delete_request_count,
    equipment_link_count AS delete_equipment_link_count

FROM tmp_shinhan_delete_candidates
ORDER BY plate_number, vehicle_id
LIMIT 100;


SELECT '-- 6. Preview первых 100 blocked-кандидатов. Их НЕ удаляем' AS check_step;

SELECT
    b.plate_number,

    k.keep_vehicle_id,
    k.keep_brand,
    k.keep_model,
    k.keep_vin,
    k.keep_request_count,
    k.keep_equipment_link_count,

    b.vehicle_id AS blocked_vehicle_id,
    b.brand AS blocked_brand,
    b.model AS blocked_model,
    b.vin AS blocked_vin,
    b.request_count AS blocked_request_count,
    b.equipment_link_count AS blocked_equipment_link_count

FROM tmp_shinhan_blocked_candidates b
INNER JOIN tmp_shinhan_keepers k
    ON k.plate_number = b.plate_number
ORDER BY b.plate_number, b.vehicle_id
LIMIT 100;


SELECT '-- 7. Контрольные числа перед UPDATE' AS check_step;

SELECT
    (@admin_user_id IS NOT NULL) AS admin_user_id_must_not_be_null,
    @do_cleanup AS do_cleanup_must_be_1,
    @target_client_id AS target_client_id,
    @expected_candidates_to_delete AS expected_candidates_to_delete,
    @expected_blocked_by_requests_or_equipment AS expected_blocked_by_requests_or_equipment;

SELECT COUNT(*) AS actual_candidates_to_delete
FROM tmp_shinhan_delete_candidates;

SELECT COUNT(*) AS actual_blocked_by_requests_or_equipment
FROM tmp_shinhan_blocked_candidates;


SELECT '-- 8. Guard-защита. guard_rows_must_be_1 должен быть 1' AS check_step;

DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_guard;

CREATE TEMPORARY TABLE tmp_shinhan_guard AS
SELECT 1 AS ok
WHERE @do_cleanup = 1
  AND @admin_user_id IS NOT NULL
  AND (SELECT COUNT(*) FROM tmp_shinhan_target_client) = 1
  AND (SELECT COUNT(*) FROM tmp_shinhan_delete_candidates) = @expected_candidates_to_delete
  AND (SELECT COUNT(*) FROM tmp_shinhan_blocked_candidates) = @expected_blocked_by_requests_or_equipment;

SELECT COUNT(*) AS guard_rows_must_be_1
FROM tmp_shinhan_guard;


SELECT '-- 9. Soft delete safe-кандидатов' AS check_step;

UPDATE vehicles v
INNER JOIN tmp_shinhan_delete_candidates dc
    ON dc.vehicle_id = v.id
INNER JOIN tmp_shinhan_guard g
    ON g.ok = 1
SET
    v.is_deleted = 1,
    v.deleted_at = NOW(),
    v.deleted_by = @admin_user_id,
    v.delete_reason_type = 'OTHER',
    v.delete_reason = CONCAT(
        'Очистка дублей после импорта GlonassSoft: safe-дубликат машины по plate_number у Shinhan Finance. ',
        'Оставлена машина ID: ', dc.keep_vehicle_id,
        ', plate_number: ', dc.plate_number
    )
WHERE v.client_id = @target_client_id
  AND v.is_deleted = 0;


SELECT '-- 10. Результат UPDATE' AS check_step;

SELECT
    COUNT(*) AS deleted_count_should_be_1021
FROM vehicles v
INNER JOIN tmp_shinhan_delete_candidates dc
    ON dc.vehicle_id = v.id
WHERE v.client_id = @target_client_id
  AND v.is_deleted = 1;


SELECT
    COUNT(*) AS remaining_safe_candidates_after_update_should_be_0
FROM vehicles v
INNER JOIN tmp_shinhan_delete_candidates dc
    ON dc.vehicle_id = v.id
WHERE v.client_id = @target_client_id
  AND v.is_deleted = 0;


SELECT '-- 11. Проверка дублей Shinhan Finance после очистки' AS check_step;

WITH after_ranked AS (
    SELECT
        v.id,
        v.client_id,
        TRIM(v.plate_number) AS plate_number,

        COUNT(DISTINCT rv.request_id) AS request_count,
        COUNT(DISTINCT re.id) AS equipment_link_count,

        ROW_NUMBER() OVER (
            PARTITION BY TRIM(v.plate_number)
            ORDER BY
                CASE
                    WHEN COUNT(DISTINCT rv.request_id) > 0
                      OR COUNT(DISTINCT re.id) > 0
                    THEN 0
                    ELSE 1
                END,
                v.id ASC
        ) AS keep_rank,

        COUNT(*) OVER (
            PARTITION BY TRIM(v.plate_number)
        ) AS group_count

    FROM vehicles v
    LEFT JOIN request_vehicles rv
        ON rv.vehicle_id = v.id
    LEFT JOIN request_equipment re
        ON re.request_vehicle_id = rv.id

    WHERE v.client_id = @target_client_id
      AND v.is_deleted = 0
      AND v.plate_number IS NOT NULL
      AND TRIM(v.plate_number) != ''

    GROUP BY
        v.id,
        v.client_id,
        TRIM(v.plate_number)
)
SELECT
    COUNT(DISTINCT CASE WHEN group_count > 1 THEN plate_number END) AS duplicate_plate_groups_after_blocked_can_remain,
    COUNT(CASE WHEN group_count > 1 THEN 1 END) AS vehicles_in_duplicate_groups_after_blocked_can_remain,
    SUM(
        CASE
            WHEN group_count > 1
             AND keep_rank > 1
             AND request_count = 0
             AND equipment_link_count = 0
            THEN 1 ELSE 0
        END
    ) AS safe_duplicates_left_after_should_be_0,
    SUM(
        CASE
            WHEN group_count > 1
             AND keep_rank > 1
             AND (request_count > 0 OR equipment_link_count > 0)
            THEN 1 ELSE 0
        END
    ) AS blocked_duplicates_left_after_expected_51
FROM after_ranked;


SELECT '-- 12. Последние удалённые машины Shinhan Finance' AS check_step;

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
  AND delete_reason LIKE 'Очистка дублей после импорта GlonassSoft: safe-дубликат машины по plate_number у Shinhan Finance.%'
ORDER BY deleted_at DESC, id DESC
LIMIT 50;


SELECT '-- 13. Очистка временных таблиц' AS check_step;

DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_guard;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_delete_candidates;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_delete_candidates_raw;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_blocked_candidates;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_keepers;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_ranked;
DROP TEMPORARY TABLE IF EXISTS tmp_shinhan_target_client;
