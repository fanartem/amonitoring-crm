from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import RequestCreate, RequestUpdate, AssignRequest, CommentCreate
from app.security import get_current_user
from datetime import datetime

router = APIRouter(prefix="/requests", tags=["Requests"])

@router.post("")
def create_request(data: RequestCreate, current_user: dict = Depends(get_current_user)):
    # ПРОЛЕЖА 1: Только Админ и Менеджер могут создавать заявки
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут создавать заявки")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            INSERT INTO requests 
            (client_id, vehicle_id, work_type, visit_type, status, city)
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.client_id, data.vehicle_id, data.work_type, 
                data.visit_type, "NEW", data.city
            ))
            request_id = cursor.lastrowid

            cursor.execute(
                "INSERT INTO request_history (request_id, user_id, action, new_value) VALUES (%s, %s, %s, %s)",
                (request_id, current_user["id"], "CREATED", "Request created")
            )

            if data.work_type == "INSTALLATION" and data.installation:
                cursor.execute(
                    "INSERT INTO installation_details (request_id, has_beacon, has_blocking) VALUES (%s, %s, %s)",
                    (request_id, data.installation.has_beacon, data.installation.has_blocking)
                )

            connection.commit()
            return {"message": "created", "request_id": request_id}
    finally:
        connection.close()

@router.get("")
def get_requests(status: str = Query(None), current_user: dict = Depends(get_current_user)):
    # Читать могут ВСЕ авторизованные пользователи
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            base_sql = """
            SELECT 
                r.id,
                r.client_id,
                r.vehicle_id,
                r.work_type,
                r.visit_type,
                r.address,
                r.city,
                r.scheduled_at,
                r.status,
                r.created_at,
                r.assigned_to,
                r.is_paid,
                r.paid_at,

                c.name AS client_name,
                c.company_name,
                c.phone,
                c.type AS client_type,

                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type AS vehicle_type,

                i.has_beacon,
                i.has_blocking
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            WHERE r.is_deleted = 0
            """
            if status:
                base_sql += " AND r.status = %s ORDER BY r.created_at DESC"
                cursor.execute(base_sql, (status,))
            else:
                base_sql += " ORDER BY r.created_at DESC"
                cursor.execute(base_sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_requests(current_user: dict = Depends(get_current_user)):
    """Список удалённых заявок. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может просматривать корзину заявок")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                r.id, r.client_id, r.vehicle_id, r.work_type, r.visit_type, r.city, 
                r.status, r.created_at, r.assigned_to, r.is_paid, r.paid_at,
                r.deleted_at, r.deleted_by,
                c.name AS client_name, c.phone,
                v.brand, v.model, v.plate_number,
                u.name AS deleted_by_name
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN users u ON r.deleted_by = u.id
            WHERE r.is_deleted = 1
            ORDER BY r.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.post("/comments")
def create_comment(data: CommentCreate, current_user: dict = Depends(get_current_user)):
    # Если хочешь, чтобы монтажники не могли оставлять комментарии, раскомментируй эту проверку:
    # if current_user["role"] == "TECHNICIAN":
    #     raise HTTPException(status_code=403, detail="Обычный монтажник не может оставлять комментарии")
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM requests
                WHERE id = %s AND is_deleted = 0
                """,
                (data.request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена или удалена")
            
            cursor.execute(
                "INSERT INTO request_comments (request_id, user_id, message) VALUES (%s, %s, %s)",
                (data.request_id, current_user["id"], data.message)
            )
            connection.commit()
        return {"message": "comment added"}
    finally:
        connection.close()

@router.patch("/{request_id}")
def update_request(request_id: int, data: RequestUpdate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    ALLOWED_TRANSITIONS = {
        "NEW": ["IN_PROGRESS", "CANCELLED"],
        "IN_PROGRESS": ["COMPLETED", "CANCELLED"],
        "COMPLETED": []
    }

    # Обычный TECHNICIAN вообще не имеет права редактировать заявку
    if current_user["role"] == "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Обычный монтажник может только просматривать заявки")

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    id,
                    client_id,
                    vehicle_id,
                    work_type,
                    visit_type,
                    address,
                    city,
                    scheduled_at,
                    status,
                    is_paid
                FROM requests
                WHERE id = %s AND is_deleted = 0
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            update_fields = []
            update_values = []

            def add_history(action: str, old_value, new_value):
                cursor.execute(
                    """
                    INSERT INTO request_history 
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        current_user["id"],
                        action,
                        str(old_value) if old_value is not None else None,
                        str(new_value) if new_value is not None else None
                    )
                )

            def add_request_update(field_name: str, new_value, history_action: str):
                old_value = req[field_name]

                if old_value != new_value:
                    update_fields.append(f"{field_name} = %s")
                    update_values.append(new_value)
                    add_history(history_action, old_value, new_value)

            # --- client_id ---
            if data.client_id is not None and data.client_id != req["client_id"]:
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять клиента заявки")

                cursor.execute(
                    """
                    SELECT id, is_deleted
                    FROM clients
                    WHERE id = %s
                    """,
                    (data.client_id,)
                )
                client = cursor.fetchone()

                if not client:
                    raise HTTPException(status_code=404, detail="Клиент не найден")

                if client["is_deleted"]:
                    raise HTTPException(status_code=400, detail="Нельзя привязать заявку к клиенту из корзины")

                add_request_update("client_id", data.client_id, "CLIENT_CHANGED")

            # --- vehicle_id ---
            if data.vehicle_id is not None and data.vehicle_id != req["vehicle_id"]:
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять машину заявки")

                cursor.execute(
                    """
                    SELECT id, client_id, is_deleted
                    FROM vehicles
                    WHERE id = %s
                    """,
                    (data.vehicle_id,)
                )
                vehicle = cursor.fetchone()

                if not vehicle:
                    raise HTTPException(status_code=404, detail="Машина не найдена")

                if vehicle["is_deleted"]:
                    raise HTTPException(status_code=400, detail="Нельзя привязать заявку к машине из корзины")

                # Машина должна принадлежать выбранному/текущему клиенту
                target_client_id = data.client_id if data.client_id is not None else req["client_id"]

                if vehicle["client_id"] != target_client_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Выбранная машина не принадлежит выбранному клиенту"
                    )

                add_request_update("vehicle_id", data.vehicle_id, "VEHICLE_CHANGED")

            # --- visit_type ---
            if data.visit_type is not None and data.visit_type != req["visit_type"]:
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять тип визита")

                allowed_visit_types = ["IN_OFFICE", "ON_SITE"]

                if data.visit_type not in allowed_visit_types:
                    raise HTTPException(status_code=400, detail="Некорректный тип визита")

                add_request_update("visit_type", data.visit_type, "VISIT_TYPE_CHANGED")

            # --- address ---
            if data.address is not None and data.address != req["address"]:
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять адрес")

                add_request_update("address", data.address, "ADDRESS_CHANGED")

            # --- city ---
            if data.city is not None and data.city != req["city"]:
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять город")

                add_request_update("city", data.city, "CITY_CHANGED")

            # --- scheduled_at ---
            if data.scheduled_at is not None:
                new_scheduled_at = data.scheduled_at.replace(tzinfo=None)

                if req["scheduled_at"] != new_scheduled_at:
                    if current_user["role"] not in ["ADMIN", "MANAGER"]:
                        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять дату заявки")

                    add_request_update("scheduled_at", new_scheduled_at, "SCHEDULED_AT_CHANGED")

            # --- is_paid ---
            if data.is_paid is not None:
                if current_user["role"] not in ["ADMIN", "ACCOUNTANT"]:
                    raise HTTPException(status_code=403, detail="Только Бухгалтер или Админ могут менять оплату")

                old_paid = bool(req["is_paid"])
                new_paid = bool(data.is_paid)

                if old_paid != new_paid:
                    paid_at_val = datetime.now() if new_paid else None

                    update_fields.append("is_paid = %s")
                    update_values.append(new_paid)

                    update_fields.append("paid_at = %s")
                    update_values.append(paid_at_val)

                    add_history("PAYMENT_UPDATED", f"is_paid={old_paid}", f"is_paid={new_paid}")

            # --- status ---
            if data.status is not None and data.status != req["status"]:
                if current_user["role"] not in ["ADMIN", "MANAGER", "SENIOR_TECHNICIAN"]:
                    raise HTTPException(status_code=403, detail="Недостаточно прав для изменения статуса")

                allowed_statuses = ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]

                if data.status not in allowed_statuses:
                    raise HTTPException(status_code=400, detail="Некорректный статус заявки")

                # ADMIN и MANAGER могут менять статус на любой
                # SENIOR_TECHNICIAN — только по разрешённым переходам
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    allowed = ALLOWED_TRANSITIONS.get(req["status"], [])
                    if data.status not in allowed:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Нельзя сменить {req['status']} на {data.status}"
                        )

                add_request_update("status", data.status, "STATUS_CHANGED")

            # --- installation details ---
            if data.installation and req["work_type"] == "INSTALLATION":
                if current_user["role"] not in ["ADMIN", "MANAGER"]:
                    raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут менять детали установки")

                cursor.execute(
                    """
                    SELECT has_beacon, has_blocking
                    FROM installation_details
                    WHERE request_id = %s
                    """,
                    (request_id,)
                )
                old_install = cursor.fetchone()

                new_has_beacon = int(data.installation.has_beacon)
                new_has_blocking = int(data.installation.has_blocking)

                if old_install:
                    old_has_beacon = int(old_install["has_beacon"])
                    old_has_blocking = int(old_install["has_blocking"])

                    if old_has_beacon != new_has_beacon:
                        add_history("HAS_BEACON_CHANGED", old_has_beacon, new_has_beacon)

                    if old_has_blocking != new_has_blocking:
                        add_history("HAS_BLOCKING_CHANGED", old_has_blocking, new_has_blocking)

                    if old_has_beacon != new_has_beacon or old_has_blocking != new_has_blocking:
                        cursor.execute(
                            """
                            UPDATE installation_details
                            SET has_beacon = %s,
                                has_blocking = %s
                            WHERE request_id = %s
                            """,
                            (new_has_beacon, new_has_blocking, request_id)
                        )
                else:
                    cursor.execute(
                        """
                        INSERT INTO installation_details
                        (request_id, has_beacon, has_blocking)
                        VALUES (%s, %s, %s)
                        """,
                        (request_id, new_has_beacon, new_has_blocking)
                    )

                    add_history(
                        "INSTALLATION_DETAILS_CREATED",
                        None,
                        f"has_beacon={new_has_beacon}, has_blocking={new_has_blocking}"
                    )

            elif data.installation and req["work_type"] != "INSTALLATION":
                raise HTTPException(
                    status_code=400,
                    detail="Детали установки можно менять только для заявок типа INSTALLATION"
                )

            # --- основной UPDATE requests ---
            if update_fields:
                update_values.append(request_id)

                sql = f"""
                UPDATE requests
                SET {', '.join(update_fields)}
                WHERE id = %s
                """

                cursor.execute(sql, tuple(update_values))

            connection.commit()

            return {
                "message": "Request updated successfully",
                "updated_fields": len(update_fields)
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/{request_id}")
def delete_request(request_id: int, current_user: dict = Depends(get_current_user)):
    """Soft delete заявки. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может удалять заявки")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if request["is_deleted"]:
                raise HTTPException(status_code=400, detail="Заявка уже удалена")

            cursor.execute(
                """
                UPDATE requests
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], request_id)
            )

            cursor.execute(
                """
                INSERT INTO request_history 
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "REQUEST_DELETED",
                    f"status={request['status']}",
                    "is_deleted=1"
                )
            )

            connection.commit()

            return {
                "message": "Заявка перемещена в корзину",
                "request_id": request_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{request_id}/restore")
def restore_request(request_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление заявки из корзины. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может восстанавливать заявки")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if not request["is_deleted"]:
                raise HTTPException(status_code=400, detail="Заявка не находится в корзине")

            cursor.execute(
                """
                UPDATE requests
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (request_id,)
            )

            cursor.execute(
                """
                INSERT INTO request_history 
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "REQUEST_RESTORED",
                    "is_deleted=1",
                    "is_deleted=0"
                )
            )

            connection.commit()

            return {
                "message": "Заявка восстановлена",
                "request_id": request_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/{request_id}/assign")
def assign_request(request_id: int, data: AssignRequest, current_user: dict = Depends(get_current_user)):
    # Только Админ и Старший монтажник могут назначать/снимать монтажника
    if current_user["role"] not in ["ADMIN", "SENIOR_TECHNICIAN"]:
        raise HTTPException(status_code=403, detail="Только Старший монтажник или Админ могут назначать заявки")
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем заявку
            cursor.execute(
                """
                SELECT status, assigned_to
                FROM requests
                WHERE id = %s AND is_deleted = 0
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            # Снимать монтажника можно только с активной заявки
            if req["status"] not in ["NEW", "IN_PROGRESS"]:
                raise HTTPException(
                    status_code=400,
                    detail="Изменять назначение можно только у новой заявки или заявки в работе"
                )

            old_assigned_to = req["assigned_to"]

            # Если technician_id == None — снимаем назначенного монтажника
            if data.technician_id is None:
                cursor.execute(
                    """
                    UPDATE requests
                    SET assigned_to = NULL,
                        status = 'NEW'
                    WHERE id = %s
                    """,
                    (request_id,)
                )

                cursor.execute(
                    """
                    INSERT INTO request_history 
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        current_user["id"],
                        "UNASSIGNED",
                        f"assigned_to={old_assigned_to}",
                        "assigned_to=NULL"
                    )
                )

                connection.commit()

                return {
                    "message": "Technician unassigned",
                    "request_id": request_id
                }

            # Если technician_id НЕ None — назначаем монтажника
            cursor.execute(
                """
                SELECT role
                FROM users
                WHERE id = %s
                """,
                (data.technician_id,)
            )
            tech = cursor.fetchone()

            if not tech or tech["role"] not in ["TECHNICIAN", "SENIOR_TECHNICIAN", "ADMIN", "WAREHOUSE_MANAGER"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить на заявку менеджера или бухгалтера"
                )

            # Назначать нового монтажника можно только на NEW
            # или можно переназначать в IN_PROGRESS — если вам это нужно
            if req["status"] not in ["NEW", "IN_PROGRESS"]:
                raise HTTPException(
                    status_code=400,
                    detail="Назначить монтажника можно только на новую заявку или заявку в работе"
                )

            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s,
                    status = 'IN_PROGRESS'
                WHERE id = %s
                """,
                (data.technician_id, request_id)
            )

            cursor.execute(
                """
                INSERT INTO request_history 
                (request_id, user_id, action, old_value, new_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "ASSIGNED",
                    f"assigned_to={old_assigned_to}",
                    f"assigned_to={data.technician_id}"
                )
            )
            
            connection.commit()

            return {
                "message": "Technician assigned",
                "request_id": request_id,
                "technician_id": data.technician_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/{request_id}")
def get_request_detail(request_id: int, current_user: dict = Depends(get_current_user)):
    # Читать могут ВСЕ
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql_request = """
            SELECT 
                r.id,
                r.client_id,
                r.vehicle_id,
                r.work_type,
                r.visit_type,
                r.address,
                r.city,
                r.scheduled_at,
                r.status,
                r.created_at,
                r.assigned_to,
                r.is_paid,
                r.paid_at,

                c.name AS client_name,
                c.company_name,
                c.phone,
                c.type AS client_type,

                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type AS vehicle_type,

                i.has_beacon,
                i.has_blocking
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            WHERE r.id = %s AND r.is_deleted = 0
            """
            cursor.execute(sql_request, (request_id,))
            request_data = cursor.fetchone()
            if not request_data:
                raise HTTPException(status_code=404, detail="Request not found")

            cursor.execute(
                "SELECT rc.id, u.name AS author, rc.message, rc.created_at FROM request_comments rc LEFT JOIN users u ON rc.user_id = u.id WHERE rc.request_id = %s ORDER BY rc.created_at ASC",
                (request_id,)
            )
            comments = cursor.fetchall()

            cursor.execute(
                "SELECT h.action, h.old_value, h.new_value, h.created_at, u.name AS user_name FROM request_history h LEFT JOIN users u ON h.user_id = u.id WHERE h.request_id = %s ORDER BY h.created_at ASC",
                (request_id,)
            )
            history = cursor.fetchall()

            return {"request": request_data, "comments": comments, "history": history}
    finally:
        connection.close()

@router.get("/{request_id}/comments")
def get_comments(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT rc.id, u.name AS author, rc.message, rc.created_at
            FROM request_comments rc
            LEFT JOIN users u ON rc.user_id = u.id
            WHERE rc.request_id = %s
            ORDER BY rc.created_at ASC
            """
            cursor.execute(sql, (request_id,))
            return cursor.fetchall()
    finally:
        connection.close()