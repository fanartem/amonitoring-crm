"""
Колокольчик клиентского кабинета.

Хранилище то же самое, что у сотрудников: таблица notifications
и справочник notification_types. Роутер отдельный, потому что
у клиента другой набор проверок:

  - /notifications закрыт для клиентских учёток (см. ensure_employee_access
    в notifications.py) и требует прав notifications.*, которых клиенту
    никто не выдаёт;
  - клиенту нельзя показывать уведомления сотрудников, даже случайно
    оказавшиеся на его user_id;
  - видимость заявки может измениться после отправки уведомления,
    и на чтении её надо проверять заново.

Последнее — главное. Уведомление рассылается по цепочке организаций
вверх, без проверки права «Портал: просмотр подклиентов»: проверять
права на отправке бессмысленно, они меняются потом. Поэтому каждый
запрос здесь джойнится с requests и отсекает всё, чей клиент не входит
в видимую ветку — по тому же правилу, что и сам список заявок.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_connection
from app.security import get_current_user

from app.permissions import can_view_portal_requests

from app.routers.portal import (
    ensure_portal_access,
    get_portal_visible_client_ids,
)

from app.notification_service import (
    PORTAL_NOTIFICATION_TYPE_CODES,
    PORTAL_TOAST_TYPE_CODES,
)


router = APIRouter(
    prefix="/portal/notifications",
    tags=["Client Portal"],
    dependencies=[Depends(ensure_portal_access)],
)


MAX_UNREAD_REQUESTS_IN_SUMMARY = 200


def ensure_can_view_portal_notifications(current_user: dict):
    """
    Все клиентские уведомления — про заявки. Нет права смотреть заявки —
    нет и колокольчика: иначе через уведомление утекает то, что закрыто
    в списке.
    """
    if not can_view_portal_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра уведомлений",
        )


def build_visible_scope(cursor, current_user: dict) -> tuple[list[int], list[str]]:
    """
    Возвращает список видимых организаций и готовые плейсхолдеры.

    Пустой список означает «ничего не видно», а не «видно всё» — это тот же
    принцип, что в user_can_access_request: отсутствие данных о доступе
    никогда не трактуется как разрешение.
    """
    client_ids = sorted(get_portal_visible_client_ids(cursor, current_user))

    return client_ids, ["%s"] * len(client_ids)


def format_portal_notification(row: dict) -> dict:
    """
    Наружу отдаём только то, что нужно интерфейсу.

    actor_user_id и user_id не отдаём: клиенту незачем знать внутренние
    идентификаторы наших сотрудников, а имя автора уже вшито в текст
    там, где оно уместно.
    """
    type_code = str(row.get("type_code") or "")

    return {
        "id": int(row["id"]),
        "type_code": type_code,
        "type_name": row.get("type_name"),
        "title": row.get("title"),
        "message": row.get("message"),
        "request_id": int(row["entity_id"]) if row.get("entity_id") else None,
        "is_read": bool(row.get("is_read")),
        "created_at": row.get("created_at"),

        # Признак «показать всплывающим окном» считает сервер.
        # На фронте он был бы вторым списком важных событий, который
        # рано или поздно разойдётся с этим.
        "is_toast": type_code in PORTAL_TOAST_TYPE_CODES,
    }


@router.get("")
def get_portal_notifications(
    only_unread: bool = Query(False),
    after_id: int | None = Query(None, ge=1),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """
    Список уведомлений кабинета.

    after_id используется опросом: фронт помнит последний известный id
    и спрашивает только то, что появилось после него. Так всплывающие
    окна показываются один раз, а не при каждом обходе.
    """
    ensure_can_view_portal_notifications(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client_ids, client_placeholders = build_visible_scope(cursor, current_user)

            if not client_ids:
                return {"items": [], "has_more": False}

            type_placeholders = ", ".join(["%s"] * len(PORTAL_NOTIFICATION_TYPE_CODES))

            conditions = [
                "n.user_id = %s",
                "n.entity_type = 'request'",
                f"n.type_code IN ({type_placeholders})",
                "r.is_deleted = 0",
                f"r.client_id IN ({', '.join(client_placeholders)})",
            ]

            values = [current_user["id"]]
            values.extend(PORTAL_NOTIFICATION_TYPE_CODES)
            values.extend(client_ids)

            if only_unread:
                conditions.append("n.is_read = 0")

            if after_id:
                conditions.append("n.id > %s")
                values.append(int(after_id))

            where_clause = " AND ".join(conditions)

            # limit + 1 — чтобы отличить «страница закончилась»
            # от «дальше ещё есть», не считая COUNT(*) отдельным запросом.
            cursor.execute(
                f"""
                SELECT
                    n.id,
                    n.type_code,
                    n.title,
                    n.message,
                    n.entity_id,
                    n.is_read,
                    n.created_at,

                    nt.name AS type_name
                FROM notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                LEFT JOIN notification_types nt
                    ON nt.code = n.type_code
                WHERE {where_clause}
                ORDER BY n.id DESC
                LIMIT %s OFFSET %s
                """,
                tuple(values + [limit + 1, offset]),
            )

            rows = cursor.fetchall() or []
            has_more = len(rows) > limit

            return {
                "items": [format_portal_notification(row) for row in rows[:limit]],
                "has_more": has_more,
            }

    finally:
        connection.close()


@router.get("/summary")
def get_portal_notifications_summary(
    current_user: dict = Depends(get_current_user),
):
    """
    Один запрос на три задачи:

      unread_count — цифра на колокольчике;
      requests     — какие заявки подсветить в списке и чем именно
                     (решение Р32(А): «изменилась» = есть непрочитанные);
      latest_id    — маркер для опроса: вырос — значит что-то произошло,
                     и открытым вкладкам пора перечитать свои данные.

    latest_id считается по всем уведомлениям, включая прочитанные:
    он про «появилось новое», а не про «осталось непрочитанное».
    """
    ensure_can_view_portal_notifications(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client_ids, client_placeholders = build_visible_scope(cursor, current_user)

            if not client_ids:
                return {"unread_count": 0, "requests": [], "latest_id": 0}

            type_placeholders = ", ".join(["%s"] * len(PORTAL_NOTIFICATION_TYPE_CODES))
            client_clause = ", ".join(client_placeholders)

            base_values = [current_user["id"]]
            base_values.extend(PORTAL_NOTIFICATION_TYPE_CODES)
            base_values.extend(client_ids)

            cursor.execute(
                f"""
                SELECT
                    COUNT(*) AS unread_count,
                    COALESCE(MAX(CASE WHEN n.is_read = 0 THEN n.id END), 0) AS unread_latest_id
                FROM notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                WHERE n.user_id = %s
                  AND n.entity_type = 'request'
                  AND n.type_code IN ({type_placeholders})
                  AND r.is_deleted = 0
                  AND r.client_id IN ({client_clause})
                  AND n.is_read = 0
                """,
                tuple(base_values),
            )

            unread_row = cursor.fetchone() or {}

            cursor.execute(
                f"""
                SELECT COALESCE(MAX(n.id), 0) AS latest_id
                FROM notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                WHERE n.user_id = %s
                  AND n.entity_type = 'request'
                  AND n.type_code IN ({type_placeholders})
                  AND r.is_deleted = 0
                  AND r.client_id IN ({client_clause})
                """,
                tuple(base_values),
            )

            latest_row = cursor.fetchone() or {}

            # Разбивка по заявкам: сколько непрочитанных и последнее
            # сообщение — оно и покажет в списке, что именно поменялось.
            cursor.execute(
                f"""
                SELECT
                    grouped.request_id,
                    grouped.unread_count,
                    n.title AS last_title,
                    n.message AS last_message,
                    n.created_at AS last_created_at
                FROM (
                    SELECT
                        n.entity_id AS request_id,
                        COUNT(*) AS unread_count,
                        MAX(n.id) AS last_notification_id
                    FROM notifications n
                    INNER JOIN requests r
                        ON r.id = n.entity_id
                    WHERE n.user_id = %s
                      AND n.entity_type = 'request'
                      AND n.type_code IN ({type_placeholders})
                      AND r.is_deleted = 0
                      AND r.client_id IN ({client_clause})
                      AND n.is_read = 0
                    GROUP BY n.entity_id
                ) AS grouped
                INNER JOIN notifications n
                    ON n.id = grouped.last_notification_id
                ORDER BY grouped.last_notification_id DESC
                LIMIT %s
                """,
                tuple(base_values + [MAX_UNREAD_REQUESTS_IN_SUMMARY]),
            )

            request_rows = cursor.fetchall() or []

            return {
                "unread_count": int(unread_row.get("unread_count") or 0),
                "latest_id": int(latest_row.get("latest_id") or 0),
                "requests": [
                    {
                        "request_id": int(row["request_id"]),
                        "unread_count": int(row["unread_count"]),
                        "last_title": row.get("last_title"),
                        "last_message": row.get("last_message"),
                        "last_created_at": row.get("last_created_at"),
                    }
                    for row in request_rows
                ],
            }

    finally:
        connection.close()


@router.patch("/read-all")
def mark_all_portal_notifications_read(
    current_user: dict = Depends(get_current_user),
):
    """
    Пометить прочитанным всё, что видно.

    Именно «что видно»: уведомления по заявкам, доступ к которым потеряли,
    остаются непрочитанными и просто не показываются. Помечать их — значит
    трогать записи, которых пользователь уже не имеет права видеть.
    """
    ensure_can_view_portal_notifications(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client_ids, client_placeholders = build_visible_scope(cursor, current_user)

            if not client_ids:
                return {"message": "Нет уведомлений", "updated_count": 0}

            type_placeholders = ", ".join(["%s"] * len(PORTAL_NOTIFICATION_TYPE_CODES))

            values = [current_user["id"]]
            values.extend(PORTAL_NOTIFICATION_TYPE_CODES)
            values.extend(client_ids)

            cursor.execute(
                f"""
                UPDATE notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                SET n.is_read = 1,
                    n.read_at = NOW()
                WHERE n.user_id = %s
                  AND n.entity_type = 'request'
                  AND n.type_code IN ({type_placeholders})
                  AND r.is_deleted = 0
                  AND r.client_id IN ({', '.join(client_placeholders)})
                  AND n.is_read = 0
                """,
                tuple(values),
            )

            updated_count = cursor.rowcount
            connection.commit()

            return {
                "message": "Все уведомления отмечены как прочитанные",
                "updated_count": updated_count,
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/requests/{request_id}/read")
def mark_portal_request_notifications_read(
    request_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Клиент открыл карточку заявки — значит увидел, что по ней произошло.

    Отсюда же снимается подсветка «заявка изменилась» в списке:
    непрочитанных по этой заявке больше нет.
    """
    ensure_can_view_portal_notifications(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client_ids, client_placeholders = build_visible_scope(cursor, current_user)

            if not client_ids:
                return {"message": "Нет уведомлений", "updated_count": 0}

            type_placeholders = ", ".join(["%s"] * len(PORTAL_NOTIFICATION_TYPE_CODES))

            values = [current_user["id"], int(request_id)]
            values.extend(PORTAL_NOTIFICATION_TYPE_CODES)
            values.extend(client_ids)

            cursor.execute(
                f"""
                UPDATE notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                SET n.is_read = 1,
                    n.read_at = NOW()
                WHERE n.user_id = %s
                  AND n.entity_type = 'request'
                  AND n.entity_id = %s
                  AND n.type_code IN ({type_placeholders})
                  AND r.is_deleted = 0
                  AND r.client_id IN ({', '.join(client_placeholders)})
                  AND n.is_read = 0
                """,
                tuple(values),
            )

            updated_count = cursor.rowcount
            connection.commit()

            return {
                "message": "Уведомления по заявке отмечены как прочитанные",
                "request_id": int(request_id),
                "updated_count": updated_count,
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{notification_id}/read")
def mark_portal_notification_read(
    notification_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Одно уведомление.

    Чужое уведомление даёт 404, а не 403: подтверждать существование
    записи, которая пользователю не принадлежит, незачем.
    """
    ensure_can_view_portal_notifications(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client_ids, client_placeholders = build_visible_scope(cursor, current_user)

            if not client_ids:
                raise HTTPException(status_code=404, detail="Уведомление не найдено")

            type_placeholders = ", ".join(["%s"] * len(PORTAL_NOTIFICATION_TYPE_CODES))

            values = [int(notification_id), current_user["id"]]
            values.extend(PORTAL_NOTIFICATION_TYPE_CODES)
            values.extend(client_ids)

            cursor.execute(
                f"""
                SELECT n.id
                FROM notifications n
                INNER JOIN requests r
                    ON r.id = n.entity_id
                WHERE n.id = %s
                  AND n.user_id = %s
                  AND n.entity_type = 'request'
                  AND n.type_code IN ({type_placeholders})
                  AND r.is_deleted = 0
                  AND r.client_id IN ({', '.join(client_placeholders)})
                LIMIT 1
                """,
                tuple(values),
            )

            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Уведомление не найдено")

            cursor.execute(
                """
                UPDATE notifications
                SET is_read = 1,
                    read_at = NOW()
                WHERE id = %s
                  AND is_read = 0
                """,
                (int(notification_id),),
            )

            connection.commit()

            return {
                "message": "Уведомление отмечено как прочитанное",
                "notification_id": int(notification_id),
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()