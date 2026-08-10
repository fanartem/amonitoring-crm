from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    SupportRequestCreate,
    SupportRequestUpdate,
    SupportRequestCommentCreate,
)
from app.permissions import (
    ADMIN,
    ROP,
    TECH_SUPPORT,
    TECHNICIAN,
    SENIOR_TECHNICIAN,
    SUPPORT_REQUEST_ASSIGNEE_ROLES,
    can_view_support_requests,
    can_create_support_request,
    can_edit_support_request,
    can_assign_support_request,
    can_change_support_request_status,
    can_delete_support_request,
    can_comment_support_request,
)

router = APIRouter(prefix="/support-requests", tags=["Support Requests"])

ALMATY_TZ = timezone(timedelta(hours=5))

SUPPORT_STATUSES = ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"]


def almaty_now():
    return datetime.now(ALMATY_TZ).replace(tzinfo=None)


def field_was_sent(data, field_name: str) -> bool:
    fields_set = getattr(data, "model_fields_set", None)

    if fields_set is None:
        fields_set = getattr(data, "__fields_set__", set())

    return field_name in fields_set


def normalize_text(value, field_label: str, required: bool = True):
    if value is None:
        if required:
            raise HTTPException(
                status_code=400,
                detail=f"{field_label} не может быть пустым"
            )

        return None

    normalized = str(value).strip()

    if required and not normalized:
        raise HTTPException(
            status_code=400,
            detail=f"{field_label} не может быть пустым"
        )

    return normalized or None


def validate_support_status(status: str):
    if status not in SUPPORT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный статус заявки техподдержки"
        )


def validate_support_priority(priority: str):
    if priority not in SUPPORT_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный приоритет заявки техподдержки"
        )


def validate_client(cursor, client_id: int) -> dict:
    cursor.execute(
        """
        SELECT
            id,
            name,
            company_name,
            phone,
            status,
            is_deleted
        FROM clients
        WHERE id = %s
        """,
        (client_id,)
    )

    client = cursor.fetchone()

    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    if client.get("is_deleted"):
        raise HTTPException(
            status_code=400,
            detail="Нельзя создать заявку техподдержки для клиента из корзины"
        )

    return client


def validate_vehicle_for_client(
    cursor,
    vehicle_id: int | None,
    client_id: int,
) -> dict | None:
    if vehicle_id is None:
        return None

    cursor.execute(
        """
        SELECT
            id,
            client_id,
            brand,
            model,
            plate_number,
            vin,
            is_deleted
        FROM vehicles
        WHERE id = %s
        """,
        (vehicle_id,)
    )

    vehicle = cursor.fetchone()

    if not vehicle:
        raise HTTPException(status_code=404, detail="Автомобиль не найден")

    if vehicle.get("is_deleted"):
        raise HTTPException(
            status_code=400,
            detail="Нельзя выбрать автомобиль из корзины"
        )

    if int(vehicle["client_id"]) != int(client_id):
        raise HTTPException(
            status_code=400,
            detail="Выбранный автомобиль не принадлежит выбранному клиенту"
        )

    return vehicle


def validate_support_assignee(cursor, user_id: int | None) -> dict | None:
    if user_id is None:
        return None

    cursor.execute(
        """
        SELECT
            id,
            name,
            role,
            is_approved,
            is_active,
            deleted_at
        FROM users
        WHERE id = %s
        """,
        (user_id,)
    )

    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Исполнитель не найден")

    if user["role"] in [TECHNICIAN, SENIOR_TECHNICIAN]:
        raise HTTPException(
            status_code=400,
            detail="Монтажников нельзя назначать исполнителями заявок техподдержки"
        )

    if user["role"] not in SUPPORT_REQUEST_ASSIGNEE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Эту роль нельзя назначить исполнителем заявки техподдержки"
        )

    if not user.get("is_approved"):
        raise HTTPException(
            status_code=400,
            detail="Исполнитель не подтверждён"
        )

    if not user.get("is_active") or user.get("deleted_at") is not None:
        raise HTTPException(
            status_code=400,
            detail="Исполнитель удалён или неактивен"
        )

    return user


def add_support_history(
    cursor,
    support_request_id: int,
    user_id: int | None,
    action: str,
    old_value=None,
    new_value=None,
):
    cursor.execute(
        """
        INSERT INTO support_request_history (
            support_request_id,
            user_id,
            action,
            old_value,
            new_value,
            created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            support_request_id,
            user_id,
            action,
            str(old_value) if old_value is not None else None,
            str(new_value) if new_value is not None else None,
            almaty_now(),
        )
    )


def get_support_request_by_id(cursor, support_request_id: int) -> dict | None:
    cursor.execute(
        """
        SELECT
            sr.id,
            sr.client_id,
            sr.vehicle_id,
            sr.contact_phone,
            sr.problem_description,
            sr.priority,
            sr.status,
            sr.assigned_to,
            sr.created_by,
            sr.created_at,
            sr.updated_at,
            sr.completed_by,
            sr.completed_at,
            sr.cancelled_by,
            sr.cancelled_at,
            sr.is_deleted,
            sr.deleted_by,
            sr.deleted_at,

            c.name AS client_name,
            c.company_name,
            c.phone AS client_phone,
            c.status AS client_status,

            v.brand AS vehicle_brand,
            v.model AS vehicle_model,
            v.plate_number AS vehicle_plate_number,
            v.vin AS vehicle_vin,

            assigned_user.name AS assigned_to_name,
            assigned_user.role AS assigned_to_role,

            creator.name AS created_by_name,
            completed_user.name AS completed_by_name,
            cancelled_user.name AS cancelled_by_name,
            deleted_user.name AS deleted_by_name
        FROM support_requests sr
        LEFT JOIN clients c ON sr.client_id = c.id
        LEFT JOIN vehicles v ON sr.vehicle_id = v.id
        LEFT JOIN users assigned_user ON sr.assigned_to = assigned_user.id
        LEFT JOIN users creator ON sr.created_by = creator.id
        LEFT JOIN users completed_user ON sr.completed_by = completed_user.id
        LEFT JOIN users cancelled_user ON sr.cancelled_by = cancelled_user.id
        LEFT JOIN users deleted_user ON sr.deleted_by = deleted_user.id
        WHERE sr.id = %s
        """,
        (support_request_id,)
    )

    return cursor.fetchone()


def attach_support_comments_and_history(cursor, support_request: dict) -> dict:
    support_request_id = support_request["id"]

    cursor.execute(
        """
        SELECT
            src.id,
            src.support_request_id,
            src.user_id,
            src.message,
            src.created_at,

            u.name AS user_name,
            u.role AS user_role
        FROM support_request_comments src
        LEFT JOIN users u ON src.user_id = u.id
        WHERE src.support_request_id = %s
        ORDER BY src.created_at ASC, src.id ASC
        """,
        (support_request_id,)
    )

    support_request["comments"] = cursor.fetchall()

    cursor.execute(
        """
        SELECT
            srh.id,
            srh.support_request_id,
            srh.user_id,
            srh.action,
            srh.old_value,
            srh.new_value,
            srh.created_at,

            u.name AS user_name,
            u.role AS user_role
        FROM support_request_history srh
        LEFT JOIN users u ON srh.user_id = u.id
        WHERE srh.support_request_id = %s
        ORDER BY srh.created_at ASC, srh.id ASC
        """,
        (support_request_id,)
    )

    support_request["history"] = cursor.fetchall()

    return support_request


@router.get("/assignees")
def get_support_request_assignees(
    current_user: dict = Depends(get_current_user),
):
    if not can_view_support_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра исполнителей техподдержки"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            placeholders = ", ".join(["%s"] * len(SUPPORT_REQUEST_ASSIGNEE_ROLES))

            cursor.execute(
                f"""
                SELECT
                    id,
                    name,
                    email,
                    role,
                    city
                FROM users
                WHERE role IN ({placeholders})
                  AND is_approved = 1
                  AND is_active = 1
                  AND deleted_at IS NULL
                ORDER BY
                    FIELD(role, 'TECH_SUPPORT', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'ROP', 'ADMIN'),
                    name ASC
                """,
                tuple(SUPPORT_REQUEST_ASSIGNEE_ROLES)
            )

            return cursor.fetchall()

    finally:
        connection.close()


@router.get("")
def get_support_requests(
    status: str | None = Query(None),
    q: str | None = Query(None),
    only_assigned_to_me: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    if not can_view_support_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра заявок техподдержки"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = ["sr.is_deleted = 0"]
            values = []

            if status:
                validate_support_status(status)
                conditions.append("sr.status = %s")
                values.append(status)

            if only_assigned_to_me:
                conditions.append("sr.assigned_to = %s")
                values.append(current_user["id"])

            if q and q.strip():
                search = f"%{q.strip()}%"

                conditions.append(
                    """
                    (
                        sr.id LIKE %s
                        OR sr.contact_phone LIKE %s
                        OR sr.problem_description LIKE %s
                        OR c.name LIKE %s
                        OR c.company_name LIKE %s
                        OR v.brand LIKE %s
                        OR v.model LIKE %s
                        OR v.plate_number LIKE %s
                        OR v.vin LIKE %s
                    )
                    """
                )

                values.extend([
                    search,
                    search,
                    search,
                    search,
                    search,
                    search,
                    search,
                    search,
                    search,
                ])

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    sr.id,
                    sr.client_id,
                    sr.vehicle_id,
                    sr.contact_phone,
                    sr.problem_description,
                    sr.priority,
                    sr.status,
                    sr.assigned_to,
                    sr.created_by,
                    sr.created_at,
                    sr.updated_at,

                    c.name AS client_name,
                    c.company_name,
                    c.phone AS client_phone,
                    c.status AS client_status,

                    v.brand AS vehicle_brand,
                    v.model AS vehicle_model,
                    v.plate_number AS vehicle_plate_number,
                    v.vin AS vehicle_vin,

                    assigned_user.name AS assigned_to_name,
                    assigned_user.role AS assigned_to_role,

                    creator.name AS created_by_name
                FROM support_requests sr
                LEFT JOIN clients c ON sr.client_id = c.id
                LEFT JOIN vehicles v ON sr.vehicle_id = v.id
                LEFT JOIN users assigned_user ON sr.assigned_to = assigned_user.id
                LEFT JOIN users creator ON sr.created_by = creator.id
                WHERE {where_clause}
                ORDER BY sr.created_at DESC, sr.id DESC
                """,
                tuple(values)
            )

            return cursor.fetchall()

    finally:
        connection.close()


@router.get("/{support_request_id}")
def get_support_request_detail(
    support_request_id: int,
    current_user: dict = Depends(get_current_user),
):
    if not can_view_support_requests(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра заявки техподдержки"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            support_request = get_support_request_by_id(cursor, support_request_id)

            if not support_request or support_request.get("is_deleted"):
                raise HTTPException(
                    status_code=404,
                    detail="Заявка техподдержки не найдена"
                )

            return attach_support_comments_and_history(cursor, support_request)

    finally:
        connection.close()


@router.post("")
def create_support_request(
    data: SupportRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    if not can_create_support_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания заявки техподдержки"
        )

    contact_phone = normalize_text(data.contact_phone, "Номер для связи")
    problem_description = normalize_text(
        data.problem_description,
        "Описание проблемы"
    )

    priority = (data.priority or "NORMAL").strip().upper()
    validate_support_priority(priority)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            validate_client(cursor, data.client_id)
            validate_vehicle_for_client(cursor, data.vehicle_id, data.client_id)

            assigned_to = data.assigned_to

            if assigned_to is not None:
                validate_support_assignee(cursor, assigned_to)

            cursor.execute(
                """
                INSERT INTO support_requests (
                    client_id,
                    vehicle_id,
                    contact_phone,
                    problem_description,
                    priority,
                    status,
                    assigned_to,
                    created_by,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, 'NEW', %s, %s, %s)
                """,
                (
                    data.client_id,
                    data.vehicle_id,
                    contact_phone,
                    problem_description,
                    priority,
                    assigned_to,
                    current_user["id"],
                    almaty_now(),
                )
            )

            support_request_id = cursor.lastrowid

            add_support_history(
                cursor=cursor,
                support_request_id=support_request_id,
                user_id=current_user["id"],
                action="CREATED",
                new_value="Заявка техподдержки создана",
            )

            if assigned_to is not None:
                add_support_history(
                    cursor=cursor,
                    support_request_id=support_request_id,
                    user_id=current_user["id"],
                    action="ASSIGNED",
                    old_value=None,
                    new_value=f"assigned_to={assigned_to}",
                )

            connection.commit()

            return {
                "message": "Заявка техподдержки создана",
                "support_request_id": support_request_id,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/{support_request_id}")
def update_support_request(
    support_request_id: int,
    data: SupportRequestUpdate,
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            support_request = get_support_request_by_id(cursor, support_request_id)

            if not support_request or support_request.get("is_deleted"):
                raise HTTPException(
                    status_code=404,
                    detail="Заявка техподдержки не найдена"
                )

            update_fields = []
            update_values = []

            def add_update(field_name: str, new_value, action: str):
                old_value = support_request.get(field_name)

                if old_value != new_value:
                    update_fields.append(f"{field_name} = %s")
                    update_values.append(new_value)
                    add_support_history(
                        cursor=cursor,
                        support_request_id=support_request_id,
                        user_id=current_user["id"],
                        action=action,
                        old_value=old_value,
                        new_value=new_value,
                    )

            if field_was_sent(data, "client_id"):
                if not can_edit_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения клиента"
                    )

                if data.client_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Клиент не может быть пустым"
                    )

                validate_client(cursor, data.client_id)

                if (
                    support_request.get("vehicle_id") is not None
                    and int(support_request["client_id"]) != int(data.client_id)
                    and not field_was_sent(data, "vehicle_id")
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="При изменении клиента нужно заново выбрать автомобиль или очистить автомобиль"
                    )

                add_update("client_id", data.client_id, "CLIENT_CHANGED")

            target_client_id = (
                data.client_id
                if field_was_sent(data, "client_id") and data.client_id is not None
                else support_request["client_id"]
            )

            if field_was_sent(data, "vehicle_id"):
                if not can_edit_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения автомобиля"
                    )

                validate_vehicle_for_client(
                    cursor=cursor,
                    vehicle_id=data.vehicle_id,
                    client_id=target_client_id,
                )

                add_update("vehicle_id", data.vehicle_id, "VEHICLE_CHANGED")

            if field_was_sent(data, "contact_phone"):
                if not can_edit_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения номера для связи"
                    )

                contact_phone = normalize_text(data.contact_phone, "Номер для связи")
                add_update("contact_phone", contact_phone, "CONTACT_PHONE_CHANGED")

            if field_was_sent(data, "problem_description"):
                if not can_edit_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения описания проблемы"
                    )

                problem_description = normalize_text(
                    data.problem_description,
                    "Описание проблемы"
                )

                add_update(
                    "problem_description",
                    problem_description,
                    "PROBLEM_DESCRIPTION_CHANGED",
                )

            if field_was_sent(data, "priority"):
                if not can_edit_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения приоритета"
                    )

                priority = (data.priority or "NORMAL").strip().upper()
                validate_support_priority(priority)

                add_update("priority", priority, "PRIORITY_CHANGED")

            if field_was_sent(data, "assigned_to"):
                if not can_assign_support_request(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для назначения исполнителя"
                    )

                validate_support_assignee(cursor, data.assigned_to)
                add_update("assigned_to", data.assigned_to, "ASSIGNED_CHANGED")

            if field_was_sent(data, "status"):
                if not can_change_support_request_status(
                    current_user,
                    support_request,
                ):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения статуса"
                    )

                if data.status is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Статус не может быть пустым"
                    )

                new_status = data.status.strip().upper()
                validate_support_status(new_status)

                if support_request["status"] != new_status:
                    update_fields.append("status = %s")
                    update_values.append(new_status)

                    if new_status == "COMPLETED":
                        update_fields.append("completed_by = %s")
                        update_values.append(current_user["id"])
                        update_fields.append("completed_at = %s")
                        update_values.append(almaty_now())
                    else:
                        update_fields.append("completed_by = NULL")
                        update_fields.append("completed_at = NULL")

                    if new_status == "CANCELLED":
                        update_fields.append("cancelled_by = %s")
                        update_values.append(current_user["id"])
                        update_fields.append("cancelled_at = %s")
                        update_values.append(almaty_now())
                    else:
                        update_fields.append("cancelled_by = NULL")
                        update_fields.append("cancelled_at = NULL")

                    add_support_history(
                        cursor=cursor,
                        support_request_id=support_request_id,
                        user_id=current_user["id"],
                        action="STATUS_CHANGED",
                        old_value=support_request["status"],
                        new_value=new_status,
                    )

            if update_fields:
                update_fields.append("updated_at = %s")
                update_values.append(almaty_now())

                update_values.append(support_request_id)

                cursor.execute(
                    f"""
                    UPDATE support_requests
                    SET {', '.join(update_fields)}
                    WHERE id = %s
                    """,
                    tuple(update_values)
                )

            connection.commit()

            return {
                "message": "Заявка техподдержки обновлена",
                "updated_fields": len(update_fields),
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.post("/{support_request_id}/comments")
def create_support_request_comment(
    support_request_id: int,
    data: SupportRequestCommentCreate,
    current_user: dict = Depends(get_current_user),
):
    if not can_comment_support_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для комментирования заявки техподдержки"
        )

    message = normalize_text(data.message, "Комментарий")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            support_request = get_support_request_by_id(cursor, support_request_id)

            if not support_request or support_request.get("is_deleted"):
                raise HTTPException(
                    status_code=404,
                    detail="Заявка техподдержки не найдена"
                )

            cursor.execute(
                """
                INSERT INTO support_request_comments (
                    support_request_id,
                    user_id,
                    message,
                    created_at
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    support_request_id,
                    current_user["id"],
                    message,
                    almaty_now(),
                )
            )

            add_support_history(
                cursor=cursor,
                support_request_id=support_request_id,
                user_id=current_user["id"],
                action="COMMENT_ADDED",
                new_value=message,
            )

            connection.commit()

            return {
                "message": "Комментарий добавлен",
                "support_request_id": support_request_id,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{support_request_id}")
def delete_support_request(
    support_request_id: int,
    current_user: dict = Depends(get_current_user),
):
    if not can_delete_support_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для удаления заявки техподдержки"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            support_request = get_support_request_by_id(cursor, support_request_id)

            if not support_request:
                raise HTTPException(
                    status_code=404,
                    detail="Заявка техподдержки не найдена"
                )

            if support_request.get("is_deleted"):
                raise HTTPException(
                    status_code=400,
                    detail="Заявка техподдержки уже удалена"
                )

            cursor.execute(
                """
                UPDATE support_requests
                SET is_deleted = 1,
                    deleted_by = %s,
                    deleted_at = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    current_user["id"],
                    almaty_now(),
                    almaty_now(),
                    support_request_id,
                )
            )

            add_support_history(
                cursor=cursor,
                support_request_id=support_request_id,
                user_id=current_user["id"],
                action="DELETED",
                old_value=f"status={support_request.get('status')}",
                new_value="is_deleted=1",
            )

            connection.commit()

            return {
                "message": "Заявка техподдержки удалена",
                "support_request_id": support_request_id,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()