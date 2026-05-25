from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.security import get_current_user
from app.schemas import NotificationSettingsBulkUpdate

router = APIRouter(prefix="/notifications", tags=["Notifications"])


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