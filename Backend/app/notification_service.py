from datetime import datetime, timedelta
from app.database import get_connection


def is_notification_enabled(cursor, user_id: int, type_code: str) -> bool:
    """
    Проверяет, включён ли конкретный тип уведомления у пользователя.

    Если персональной настройки нет, используется default_enabled из notification_types.
    """
    cursor.execute(
        """
        SELECT
            COALESCE(uns.is_enabled, nt.default_enabled) AS is_enabled
        FROM notification_types nt
        LEFT JOIN user_notification_settings uns
            ON uns.notification_type_code = nt.code
            AND uns.user_id = %s
        WHERE nt.code = %s
          AND nt.is_active = 1
        """,
        (user_id, type_code),
    )

    row = cursor.fetchone()

    if not row:
        return False

    return bool(row["is_enabled"])


def create_notification(
    cursor,
    user_id: int,
    type_code: str,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor_user_id: int | None = None,
):
    """
    Создаёт одно уведомление конкретному пользователю.

    Важно:
    - cursor передаётся снаружи, чтобы уведомление создавалось в той же транзакции,
      что и основное действие: создание заявки, назначение, смена статуса и т.д.
    - если пользователь отключил этот тип уведомлений, запись не создаётся.
    """
    if not user_id:
        return None

    if not is_notification_enabled(cursor, user_id, type_code):
        return None

    cursor.execute(
        """
        INSERT INTO notifications (
            user_id,
            type_code,
            title,
            message,
            entity_type,
            entity_id,
            actor_user_id
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            user_id,
            type_code,
            title,
            message,
            entity_type,
            entity_id,
            actor_user_id,
        ),
    )

    return cursor.lastrowid


def create_notifications_for_users(
    cursor,
    user_ids: list[int],
    type_code: str,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor_user_id: int | None = None,
    exclude_user_id: int | None = None,
):
    """
    Создаёт уведомление списку пользователей.
    Дубли user_id автоматически убираются.
    """
    created_ids = []

    unique_user_ids = []

    for user_id in user_ids:
        if not user_id:
            continue

        if exclude_user_id and int(user_id) == int(exclude_user_id):
            continue

        if user_id not in unique_user_ids:
            unique_user_ids.append(user_id)

    for user_id in unique_user_ids:
        notification_id = create_notification(
            cursor=cursor,
            user_id=user_id,
            type_code=type_code,
            title=title,
            message=message,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_user_id=actor_user_id,
        )

        if notification_id:
            created_ids.append(notification_id)

    return created_ids


def get_users_by_roles(
    cursor,
    roles: list[str],
    city: str | None = None,
    use_city_access: bool = True,
):
    """
    Возвращает пользователей по ролям.

    Если city передан:
    - сначала учитывается user_city_access;
    - также оставлен fallback на users.city, чтобы старая логика не сломалась.
    """
    if not roles:
        return []

    role_placeholders = ", ".join(["%s"] * len(roles))
    values = list(roles)

    if city and use_city_access:
        cursor.execute(
            f"""
            SELECT DISTINCT u.id
            FROM users u
            LEFT JOIN user_city_access uca
                ON uca.user_id = u.id
                AND uca.can_receive_notifications = 1
            LEFT JOIN cities c
                ON c.id = uca.city_id
                AND c.is_active = 1
            WHERE u.role IN ({role_placeholders})
              AND u.is_approved = 1
              AND (
                    u.city = %s
                    OR c.name = %s
              )
            """,
            tuple(values + [city, city]),
        )
    elif city:
        cursor.execute(
            f"""
            SELECT DISTINCT u.id
            FROM users u
            WHERE u.role IN ({role_placeholders})
              AND u.is_approved = 1
              AND u.city = %s
            """,
            tuple(values + [city]),
        )
    else:
        cursor.execute(
            f"""
            SELECT DISTINCT u.id
            FROM users u
            WHERE u.role IN ({role_placeholders})
              AND u.is_approved = 1
            """,
            tuple(values),
        )

    rows = cursor.fetchall()

    return [row["id"] for row in rows]


def create_notifications_for_roles(
    cursor,
    roles: list[str],
    type_code: str,
    title: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor_user_id: int | None = None,
    city: str | None = None,
    exclude_user_id: int | None = None,
):
    """
    Создаёт уведомления пользователям с указанными ролями.

    Если city передан — уведомления получат только пользователи,
    у которых:
    - users.city = city
    или
    - есть доступ к этому городу в user_city_access.
    """
    user_ids = get_users_by_roles(
        cursor=cursor,
        roles=roles,
        city=city,
        use_city_access=True,
    )

    return create_notifications_for_users(
        cursor=cursor,
        user_ids=user_ids,
        type_code=type_code,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_user_id=actor_user_id,
        exclude_user_id=exclude_user_id,
    )


def notify_new_request(
    cursor,
    request_id: int,
    city: str | None,
    client_name: str | None = None,
    company_name: str | None = None,
    actor_user_id: int | None = None,
):
    """
    Уведомления при создании новой заявки.

    Логика:
    - ADMIN, MANAGER, ACCOUNTANT, WAREHOUSE_MANAGER получают все новые заявки.
    - TECHNICIAN и SENIOR_TECHNICIAN получают только заявки своего города / доступных городов.
    """
    display_client = company_name or client_name or "клиент не указан"
    display_city = city or "город не указан"

    title = "Новая заявка"
    message = f"Создана заявка №{request_id}. Клиент: {display_client}. Город: {display_city}."

    # Все роли, которым важны все новые заявки
    created_global = create_notifications_for_roles(
        cursor=cursor,
        roles=["ADMIN", "MANAGER", "ACCOUNTANT", "WAREHOUSE_MANAGER"],
        type_code="NEW_REQUEST",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        city=None,
        exclude_user_id=actor_user_id,
    )

    # Монтажники и старшие — только по городу / доступным городам
    created_city = create_notifications_for_roles(
        cursor=cursor,
        roles=["TECHNICIAN", "SENIOR_TECHNICIAN"],
        type_code="NEW_REQUEST",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        city=city,
        exclude_user_id=actor_user_id,
    )

    return created_global + created_city


def notify_request_status_changed(
    cursor,
    request_id: int,
    old_status: str,
    new_status: str,
    assigned_to: int | None = None,
    actor_user_id: int | None = None,
):
    """
    Уведомления при изменении статуса заявки.
    Пока уведомляем ADMIN/MANAGER и назначенного монтажника, если есть.
    """
    status_labels = {
        "NEW": "В ожидании",
        "IN_PROGRESS": "В процессе",
        "COMPLETED": "Завершено",
        "CANCELLED": "Отменено",
    }

    title = "Статус заявки изменён"
    message = (
        f"Заявка №{request_id}: "
        f"{status_labels.get(old_status, old_status)} → {status_labels.get(new_status, new_status)}."
    )

    created = create_notifications_for_roles(
        cursor=cursor,
        roles=["ADMIN", "MANAGER"],
        type_code="REQUEST_STATUS_CHANGED",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        exclude_user_id=actor_user_id,
    )

    if assigned_to:
        created += create_notifications_for_users(
            cursor=cursor,
            user_ids=[assigned_to],
            type_code="REQUEST_STATUS_CHANGED",
            title=title,
            message=message,
            entity_type="request",
            entity_id=request_id,
            actor_user_id=actor_user_id,
            exclude_user_id=actor_user_id,
        )

    return created


def notify_request_assigned(
    cursor,
    request_id: int,
    technician_id: int,
    actor_user_id: int | None = None,
):
    """
    Уведомление назначенному монтажнику.
    """
    title = "Вам назначена заявка"
    message = f"Вам назначена заявка №{request_id}."

    return create_notifications_for_users(
        cursor=cursor,
        user_ids=[technician_id],
        type_code="REQUEST_ASSIGNED",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        exclude_user_id=actor_user_id,
    )


def notify_request_executors_assigned(
    cursor,
    request_id: int,
    executor_ids: list[int],
    actor_user_id: int | None = None,
):
    """
    Уведомление нескольким назначенным исполнителям.
    """
    title = "Вам назначена заявка"
    message = f"Вам назначена заявка №{request_id}."

    return create_notifications_for_users(
        cursor=cursor,
        user_ids=executor_ids,
        type_code="REQUEST_ASSIGNED",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        exclude_user_id=actor_user_id,
    )


def notify_request_self_accepted(
    cursor,
    request_id: int,
    technician_id: int,
    actor_user_id: int | None = None,
):
    """
    Уведомления когда монтажник сам принял заявку.
    Уведомляем ADMIN/MANAGER/SENIOR_TECHNICIAN.
    """
    title = "Заявка принята в работу"
    message = f"Заявка №{request_id} была самостоятельно принята монтажником."

    return create_notifications_for_roles(
        cursor=cursor,
        roles=["ADMIN", "MANAGER", "SENIOR_TECHNICIAN"],
        type_code="REQUEST_SELF_ACCEPTED",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id or technician_id,
        exclude_user_id=actor_user_id or technician_id,
    )


def notify_request_payment_changed(
    cursor,
    request_id: int,
    is_paid: bool,
    actor_user_id: int | None = None,
):
    """
    Уведомления при изменении оплаты.
    """
    title = "Статус оплаты изменён"
    message = f"Заявка №{request_id}: {'оплачено' if is_paid else 'ожидает оплаты'}."

    return create_notifications_for_roles(
        cursor=cursor,
        roles=["ADMIN", "MANAGER", "ACCOUNTANT"],
        type_code="REQUEST_PAYMENT_CHANGED",
        title=title,
        message=message,
        entity_type="request",
        entity_id=request_id,
        actor_user_id=actor_user_id,
        exclude_user_id=actor_user_id,
    )

REQUEST_TIME_CONFLICT = "REQUEST_TIME_CONFLICT"


def format_request_datetime(value: datetime | None) -> str:
    if not value:
        return "время не указано"

    return value.strftime("%d.%m.%Y %H:%M")


def get_request_time_conflicts(
    cursor,
    request_id: int,
    scheduled_at: datetime | None,
    city: str | None,
) -> list[dict]:
    """
    Ищет заявки, которые пересекаются с новой заявкой.

    Правило:
    - каждая заявка занимает 1 час;
    - конфликт есть, если интервалы пересекаются;
    - город должен совпадать;
    - удалённые и отменённые заявки не учитываем.
    """
    if not request_id or not scheduled_at or not city or not str(city).strip():
        return []

    request_start = scheduled_at
    request_end = scheduled_at + timedelta(hours=1)

    cursor.execute(
        """
        SELECT
            r.id,
            r.city,
            r.scheduled_at,
            r.work_type,
            r.status,

            c.name AS client_name,
            c.company_name
        FROM requests r
        LEFT JOIN clients c ON r.client_id = c.id
        WHERE r.id <> %s
          AND r.is_deleted = 0
          AND r.status <> 'CANCELLED'
          AND r.scheduled_at IS NOT NULL
          AND LOWER(TRIM(r.city)) = LOWER(TRIM(%s))
          AND r.scheduled_at < %s
          AND DATE_ADD(r.scheduled_at, INTERVAL 1 HOUR) > %s
        ORDER BY r.scheduled_at ASC, r.id ASC
        """,
        (
            request_id,
            city,
            request_end,
            request_start,
        ),
    )

    return cursor.fetchall()


def get_admin_users_for_request_time_conflict(
    cursor,
    city: str | None,
    exclude_user_id: int | None = None,
) -> list[int]:
    """
    Возвращает ADMIN, которым можно отправить уведомление о пересечении.

    Учитываем:
    - пользователь активен и подтверждён;
    - роль строго ADMIN;
    - пользователь не является автором действия;
    - пользователь не добавил этот город в игнор-лист для REQUEST_TIME_CONFLICT.
    """
    if not city or not str(city).strip():
        return []

    values = []

    exclude_condition = ""

    if exclude_user_id:
        exclude_condition = "AND u.id <> %s"
        values.append(exclude_user_id)

    values.extend([REQUEST_TIME_CONFLICT, city])

    cursor.execute(
        f"""
        SELECT DISTINCT u.id
        FROM users u
        WHERE u.role = 'ADMIN'
          AND u.is_approved = 1
          AND u.is_active = 1
          AND u.deleted_at IS NULL
          {exclude_condition}
          AND NOT EXISTS (
                SELECT 1
                FROM user_notification_ignored_cities unic
                INNER JOIN cities c ON c.id = unic.city_id
                WHERE unic.user_id = u.id
                  AND unic.notification_type_code = %s
                  AND c.is_active = 1
                  AND LOWER(TRIM(c.name)) = LOWER(TRIM(%s))
          )
        """,
        tuple(values),
    )

    rows = cursor.fetchall()

    return [row["id"] for row in rows]


def notify_request_time_conflict(
    cursor,
    request_id: int,
    scheduled_at: datetime | None,
    city: str | None,
    client_name: str | None = None,
    company_name: str | None = None,
    actor_user_id: int | None = None,
):
    """
    Уведомление администраторам о пересечении заявок по времени.

    Создаётся только если:
    - новая заявка пересекается с другой активной заявкой;
    - город совпадает;
    - каждая заявка считается как интервал 1 час;
    - конкретный ADMIN не отключил этот город в настройках.
    """
    conflicts = get_request_time_conflicts(
        cursor=cursor,
        request_id=request_id,
        scheduled_at=scheduled_at,
        city=city,
    )

    if not conflicts:
        return []

    admin_user_ids = get_admin_users_for_request_time_conflict(
        cursor=cursor,
        city=city,
        exclude_user_id=actor_user_id,
    )

    if not admin_user_ids:
        return []

    conflict_ids = [int(row["id"]) for row in conflicts]
    conflict_ids_text = ", ".join(f"№{item_id}" for item_id in conflict_ids)

    display_city = city or "город не указан"
    display_client = company_name or client_name or "клиент не указан"
    display_time = format_request_datetime(scheduled_at)

    title = "Пересечение заявок по времени"
    message = (
        f"Создана заявка №{request_id}. "
        f"Клиент: {display_client}. "
        f"Город: {display_city}. "
        f"Время: {display_time}. "
        f"Пересекается с заявками: {conflict_ids_text}."
    )

    created_ids = []

    for admin_user_id in admin_user_ids:
        notification_id = create_notification(
            cursor=cursor,
            user_id=admin_user_id,
            type_code=REQUEST_TIME_CONFLICT,
            title=title,
            message=message,
            entity_type="request",
            entity_id=request_id,
            actor_user_id=actor_user_id,
        )

        if notification_id:
            created_ids.append(notification_id)

    return created_ids