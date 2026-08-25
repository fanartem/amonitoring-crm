from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    NotificationSettingsBulkUpdate,
    NotificationIgnoredCitiesUpdate,
)
from app.permissions import has_any_permission

router = APIRouter(prefix="/notifications", tags=["Notifications"])


NOTIFICATION_VIEW_PERMISSION_CODES = [
    "notifications.view",
    "notifications.manage",
]

NOTIFICATION_SETTINGS_PERMISSION_CODES = [
    "notifications.settings.manage",
    "notifications.manage",
    "settings.notifications.manage",
    "settings.manage",
]


def permissions_are_loaded(current_user: dict | None) -> bool:
    return current_user is not None and isinstance(current_user.get("permissions"), list)


def has_legacy_role(current_user: dict | None, roles: list[str]) -> bool:
    if not current_user or permissions_are_loaded(current_user):
        return False

    return current_user.get("role") in roles


def user_has_any_permission(current_user: dict | None, permission_codes: list[str]) -> bool:
    return has_any_permission(current_user, permission_codes)


def require_notifications_view(current_user: dict):
    if user_has_any_permission(current_user, NOTIFICATION_VIEW_PERMISSION_CODES) or has_legacy_role(
        current_user,
        ["ADMIN", "ROP", "MANAGER", "TECH_SUPPORT", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SENIOR_TECHNICIAN", "TECHNICIAN"],
    ):
        return

    raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра уведомлений")


def require_notification_settings_self_manage(current_user: dict):
    if user_has_any_permission(current_user, NOTIFICATION_VIEW_PERMISSION_CODES + NOTIFICATION_SETTINGS_PERMISSION_CODES) or has_legacy_role(
        current_user,
        ["ADMIN", "ROP", "MANAGER", "TECH_SUPPORT", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SENIOR_TECHNICIAN", "TECHNICIAN"],
    ):
        return

    raise HTTPException(status_code=403, detail="Недостаточно прав для настройки уведомлений")


def normalize_bool(value):
    return bool(value)


def format_notification_row(row: dict) -> dict:
    if not row:
        return row

    row["is_read"] = bool(row.get("is_read"))

    return row


@router.get("")
def get_notifications(
    only_unread: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """
    Список уведомлений текущего пользователя.
    По умолчанию возвращает последние 30 уведомлений.
    """
    require_notifications_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            values = [current_user["id"]]
            conditions = ["n.user_id = %s"]

            if only_unread:
                conditions.append("n.is_read = 0")

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    n.id,
                    n.user_id,
                    n.type_code,
                    n.title,
                    n.message,
                    n.entity_type,
                    n.entity_id,
                    n.actor_user_id,
                    n.is_read,
                    n.read_at,
                    n.created_at,

                    nt.name AS type_name,
                    nt.category AS type_category,

                    u.name AS actor_name
                FROM notifications n
                LEFT JOIN notification_types nt ON n.type_code = nt.code
                LEFT JOIN users u ON n.actor_user_id = u.id
                WHERE {where_clause}
                ORDER BY n.created_at DESC
                LIMIT %s OFFSET %s
                """,
                tuple(values + [limit, offset])
            )

            rows = cursor.fetchall()

            return [format_notification_row(row) for row in rows]

    finally:
        connection.close()


@router.get("/unread-count")
def get_unread_count(current_user: dict = Depends(get_current_user)):
    """
    Количество непрочитанных уведомлений для badge в колокольчике.
    """
    require_notifications_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS unread_count
                FROM notifications
                WHERE user_id = %s
                AND is_read = 0
                """,
                (current_user["id"],)
            )

            result = cursor.fetchone()

            return {
                "unread_count": result["unread_count"] if result else 0
            }

    finally:
        connection.close()


@router.patch("/read-all")
def mark_all_notifications_as_read(current_user: dict = Depends(get_current_user)):
    """
    Пометить все уведомления текущего пользователя как прочитанные.
    """
    require_notifications_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE notifications
                SET is_read = 1,
                    read_at = NOW()
                WHERE user_id = %s
                AND is_read = 0
                """,
                (current_user["id"],)
            )

            updated_count = cursor.rowcount
            connection.commit()

            return {
                "message": "Все уведомления отмечены как прочитанные",
                "updated_count": updated_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{notification_id}/read")
def mark_notification_as_read(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Пометить одно уведомление как прочитанное.
    Пользователь может менять только свои уведомления.
    """
    require_notifications_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, user_id, is_read
                FROM notifications
                WHERE id = %s
                """,
                (notification_id,)
            )

            notification = cursor.fetchone()

            if not notification:
                raise HTTPException(status_code=404, detail="Уведомление не найдено")

            if notification["user_id"] != current_user["id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя изменить чужое уведомление"
                )

            cursor.execute(
                """
                UPDATE notifications
                SET is_read = 1,
                    read_at = NOW()
                WHERE id = %s
                """,
                (notification_id,)
            )

            connection.commit()

            return {
                "message": "Уведомление отмечено как прочитанное",
                "notification_id": notification_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/read")
def delete_read_notifications(current_user: dict = Depends(get_current_user)):
    """
    Удалить все прочитанные уведомления текущего пользователя.
    Непрочитанные уведомления не удаляются.
    """
    require_notifications_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM notifications
                WHERE user_id = %s
                AND is_read = 1
                """,
                (current_user["id"],)
            )

            deleted_count = cursor.rowcount
            connection.commit()

            return {
                "message": "Прочитанные уведомления удалены",
                "deleted_count": deleted_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/settings")
def get_notification_settings(current_user: dict = Depends(get_current_user)):
    """
    Настройки уведомлений текущего пользователя.

    Если персональной настройки нет, используется default_enabled из notification_types.
    """
    require_notification_settings_self_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    nt.code AS type_code,
                    nt.name,
                    nt.description,
                    nt.category,
                    COALESCE(uns.is_enabled, nt.default_enabled) AS is_enabled
                FROM notification_types nt
                LEFT JOIN user_notification_settings uns
                    ON uns.notification_type_code = nt.code
                    AND uns.user_id = %s
                WHERE nt.is_active = 1
                ORDER BY nt.category ASC, nt.id ASC
                """,
                (current_user["id"],)
            )

            rows = cursor.fetchall()

            for row in rows:
                row["is_enabled"] = bool(row["is_enabled"])

            return rows

    finally:
        connection.close()


@router.patch("/settings")
def update_notification_settings(
    data: NotificationSettingsBulkUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Обновление настроек уведомлений текущего пользователя пачкой.
    """
    require_notification_settings_self_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            for setting in data.settings:
                cursor.execute(
                    """
                    SELECT code
                    FROM notification_types
                    WHERE code = %s
                    AND is_active = 1
                    """,
                    (setting.type_code,)
                )

                notification_type = cursor.fetchone()

                if not notification_type:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Неизвестный тип уведомления: {setting.type_code}"
                    )

                cursor.execute(
                    """
                    INSERT INTO user_notification_settings (
                        user_id,
                        notification_type_code,
                        is_enabled
                    )
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        is_enabled = VALUES(is_enabled),
                        updated_at = NOW()
                    """,
                    (
                        current_user["id"],
                        setting.type_code,
                        bool(setting.is_enabled),
                    )
                )

            connection.commit()

            return {
                "message": "Настройки уведомлений обновлены",
                "updated_count": len(data.settings)
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

REQUEST_TIME_CONFLICT = "REQUEST_TIME_CONFLICT"

REQUEST_TIME_CONFLICT_SETTINGS_PERMISSION_CODES = [
    "notifications.settings.manage",
    "notifications.request_time_conflict.manage",
    "settings.notifications.manage",
    "settings.manage",
]


def can_manage_request_time_conflict_settings(current_user: dict) -> bool:
    return (
        has_any_permission(
            current_user,
            REQUEST_TIME_CONFLICT_SETTINGS_PERMISSION_CODES,
        )
        or has_legacy_role(current_user, ["ADMIN"])
    )


def require_request_time_conflict_settings_manage(current_user: dict):
    if not can_manage_request_time_conflict_settings(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для настройки уведомлений о пересечении заявок",
        )


@router.get("/settings/request-time-conflict/ignored-cities")
def get_request_time_conflict_ignored_cities(
    current_user: dict = Depends(get_current_user),
):
    """
    Список городов для настройки:
    какие города игнорировать для уведомлений о пересечении заявок.
    """
    require_request_time_conflict_settings_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    c.id AS city_id,
                    c.name AS city_name,
                    CASE
                        WHEN unic.id IS NULL THEN 0
                        ELSE 1
                    END AS is_ignored
                FROM cities c
                LEFT JOIN user_notification_ignored_cities unic
                    ON unic.city_id = c.id
                    AND unic.user_id = %s
                    AND unic.notification_type_code = %s
                WHERE c.is_active = 1
                ORDER BY c.name ASC
                """,
                (
                    current_user["id"],
                    REQUEST_TIME_CONFLICT,
                )
            )

            rows = cursor.fetchall()

            for row in rows:
                row["is_ignored"] = bool(row["is_ignored"])

            return rows

    finally:
        connection.close()


@router.patch("/settings/request-time-conflict/ignored-cities")
def update_request_time_conflict_ignored_cities(
    data: NotificationIgnoredCitiesUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Сохраняет города, по которым админ не хочет получать
    уведомления о пересечении заявок.
    """
    require_request_time_conflict_settings_manage(current_user)

    unique_city_ids = []

    for city_id in data.city_ids:
        city_id = int(city_id)

        if city_id not in unique_city_ids:
            unique_city_ids.append(city_id)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            if unique_city_ids:
                placeholders = ", ".join(["%s"] * len(unique_city_ids))

                cursor.execute(
                    f"""
                    SELECT id
                    FROM cities
                    WHERE id IN ({placeholders})
                      AND is_active = 1
                    """,
                    tuple(unique_city_ids)
                )

                existing_rows = cursor.fetchall()
                existing_city_ids = [int(row["id"]) for row in existing_rows]

                missing_city_ids = [
                    city_id
                    for city_id in unique_city_ids
                    if city_id not in existing_city_ids
                ]

                if missing_city_ids:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Города не найдены или неактивны: {missing_city_ids}"
                    )

            cursor.execute(
                """
                DELETE FROM user_notification_ignored_cities
                WHERE user_id = %s
                  AND notification_type_code = %s
                """,
                (
                    current_user["id"],
                    REQUEST_TIME_CONFLICT,
                )
            )

            for city_id in unique_city_ids:
                cursor.execute(
                    """
                    INSERT INTO user_notification_ignored_cities (
                        user_id,
                        notification_type_code,
                        city_id
                    )
                    VALUES (%s, %s, %s)
                    """,
                    (
                        current_user["id"],
                        REQUEST_TIME_CONFLICT,
                        city_id,
                    )
                )

            connection.commit()

            return {
                "message": "Настройки городов обновлены",
                "ignored_city_ids": unique_city_ids,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()