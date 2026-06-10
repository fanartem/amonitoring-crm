from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import RequestCreate, RequestUpdate, AssignRequest, CommentCreate
from app.security import get_current_user

from app.permissions import (
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    SENIOR_TECHNICIAN,
    TECHNICIAN,
    can_create_request,
    can_edit_all_requests,
    can_change_request_status,
    can_delete_any_request,
    can_delete_own_request_with_time_limit,
    can_view_price_fields,
    can_create_request_for_client,
    is_client_owned_by_user,
    is_technician,
    is_senior_technician,
    is_manager,
    is_tech_support,
)

from datetime import datetime
from app.notification_service import (
    notify_new_request,
    notify_request_status_changed,
    notify_request_assigned,
    notify_request_self_accepted,
    notify_request_payment_changed,
)

router = APIRouter(prefix="/requests", tags=["Requests"])

REQUEST_DELETE_TIME_LIMIT_SECONDS = 120

def get_current_user_city(cursor, current_user: dict):
    """
    Берём city из current_user, если он уже есть.
    Если нет — достаём из БД.
    """
    if current_user.get("city"):
        return current_user["city"]

    cursor.execute(
        """
        SELECT city
        FROM users
        WHERE id = %s
        """,
        (current_user["id"],)
    )
    user = cursor.fetchone()

    if not user:
        return None

    return user.get("city")


def normalize_city(city):
    if city is None:
        return None
    return str(city).strip().lower()

def hide_request_prices(requests: list[dict]) -> list[dict]:
    for req in requests:
        req["total_price"] = None

        if "price_lines" in req:
            req["price_lines"] = []

    return requests


def attach_request_permissions(request: dict, current_user: dict) -> dict:
    role = current_user.get("role")
    user_id = int(current_user["id"])

    created_by = request.get("created_by")
    responsible_manager_id = request.get("responsible_manager_id")

    is_creator = created_by is not None and int(created_by) == user_id
    is_responsible_manager = (
        responsible_manager_id is not None
        and int(responsible_manager_id) == user_id
    )

    request["can_edit"] = (
        can_edit_all_requests(current_user)
        or (role == MANAGER and (is_creator or is_responsible_manager))
    )

    request["can_change_status"] = can_change_request_status(current_user)

    request["can_delete"] = can_delete_any_request(current_user)

    if can_delete_own_request_with_time_limit(current_user) and is_creator:
        request["can_delete_own_with_time_limit"] = True
    else:
        request["can_delete_own_with_time_limit"] = False

    request["can_view_prices"] = can_view_price_fields(current_user)

    return request


def attach_requests_permissions(requests: list[dict], current_user: dict) -> list[dict]:
    for request in requests:
        attach_request_permissions(request, current_user)

    return requests


def user_can_access_request(
    request: dict,
    current_user: dict,
    user_city: str | None = None
) -> bool:
        role = current_user.get("role")
        user_id = int(current_user["id"])

        if role in [ADMIN, ROP, ACCOUNTANT]:
            return True

        if role == SENIOR_TECHNICIAN:
            return True

        if role == TECH_SUPPORT:
            return (
                request.get("created_by") is not None
                and int(request["created_by"]) == user_id
            )

        if role == MANAGER:
            created_by = request.get("created_by")
            responsible_manager_id = request.get("responsible_manager_id")

            return (
                created_by is not None and int(created_by) == user_id
            ) or (
                responsible_manager_id is not None
                and int(responsible_manager_id) == user_id
            )

        if role == TECHNICIAN:
            if not request.get("is_paid"):
                return False

            technician_city = user_city or current_user.get("city")

            if normalize_city(request.get("city")) != normalize_city(technician_city):
                return False

            assigned_to = request.get("assigned_to")
            return assigned_to is None or int(assigned_to) == user_id

        return False

def attach_vehicles_to_requests(cursor, requests: list[dict]) -> list[dict]:
    """
    Добавляет к каждой заявке массив vehicles[] из request_vehicles.

    Новая структура:
    request = шапка заявки
    vehicles[] = автомобили внутри заявки + параметры установки
    """
    if not requests:
        return requests

    request_ids = [r["id"] for r in requests]
    placeholders = ", ".join(["%s"] * len(request_ids))

    cursor.execute(
        f"""
        SELECT
            rv.id AS request_vehicle_id,
            rv.request_id,
            rv.vehicle_id,
            rv.has_beacon,
            rv.has_blocking,

            v.brand,
            v.model,
            v.plate_number,
            v.vin,
            v.year,
            v.type AS vehicle_type
        FROM request_vehicles rv
        LEFT JOIN vehicles v ON rv.vehicle_id = v.id
        WHERE rv.request_id IN ({placeholders})
        ORDER BY rv.id ASC
        """,
        tuple(request_ids)
    )

    rows = cursor.fetchall()

    request_vehicle_ids = [row["request_vehicle_id"] for row in rows]

    sensors_grouped = {}

    if request_vehicle_ids:
        sensor_placeholders = ", ".join(["%s"] * len(request_vehicle_ids))

        cursor.execute(
            f"""
            SELECT
                id,
                request_vehicle_id,
                name,
                price,
                created_at
            FROM request_vehicle_extra_sensors
            WHERE request_vehicle_id IN ({sensor_placeholders})
            ORDER BY id ASC
            """,
            tuple(request_vehicle_ids)
        )

        sensor_rows = cursor.fetchall()

        for sensor in sensor_rows:
            sensors_grouped.setdefault(sensor["request_vehicle_id"], []).append(sensor)
    
    grouped = {}

    for row in rows:
        row["has_beacon"] = bool(row["has_beacon"])
        row["has_blocking"] = bool(row["has_blocking"])
        row["extra_sensors"] = sensors_grouped.get(row["request_vehicle_id"], [])

        grouped.setdefault(row["request_id"], []).append(row)

    for req in requests:
        vehicles = grouped.get(req["id"], [])

        req["vehicles"] = vehicles
        req["vehicles_count"] = len(vehicles)

        if vehicles:
            req["vehicles_summary"] = ", ".join(
                f"{v.get('brand') or ''} {v.get('model') or ''}".strip()
                for v in vehicles
            )
        else:
            req["vehicles_summary"] = ""

    return requests

@router.post("")
def create_request(data: RequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Создание заявки с несколькими автомобилями.
    requests = шапка заявки
    request_vehicles = автомобили внутри заявки + параметры установки
    """
    if not can_create_request(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания заявки"
        )

    if not data.vehicles:
        raise HTTPException(
            status_code=400,
            detail="Нужно добавить хотя бы один автомобиль в заявку"
        )

    allowed_work_types = ["INSTALLATION", "DIAGNOSTIC", "REMOVAL", "REFLASHING"]
    allowed_visit_types = ["IN_OFFICE", "ON_SITE"]

    if data.work_type not in allowed_work_types:
        raise HTTPException(status_code=400, detail="Некорректный тип работ")

    if data.visit_type not in allowed_visit_types:
        raise HTTPException(status_code=400, detail="Некорректный формат работ")

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # Проверяем клиента
            cursor.execute(
                """
                SELECT
                    id,
                    status,
                    created_by,
                    responsible_manager_id,
                    is_deleted
                FROM clients
                WHERE id = %s
                """,
                (data.client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя создать заявку для клиента из корзины"
                )
            
            if client["status"] == "BLOCKED":
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя создать заявку для заблокированного клиента"
                )

            if not can_create_request_for_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для создания заявки по этому клиенту"
                )

            # Проверяем все автомобили до создания заявки
            vehicle_ids = [v.vehicle_id for v in data.vehicles]

            if len(vehicle_ids) != len(set(vehicle_ids)):
                raise HTTPException(
                    status_code=400,
                    detail="Один и тот же автомобиль нельзя добавить в заявку несколько раз"
                )

            placeholders = ", ".join(["%s"] * len(vehicle_ids))

            cursor.execute(
                f"""
                SELECT id, client_id, is_deleted, vin
                FROM vehicles
                WHERE id IN ({placeholders})
                """,
                tuple(vehicle_ids)
            )
            vehicles_from_db = cursor.fetchall()
            vehicles_map = {v["id"]: v for v in vehicles_from_db}

            for vehicle_input in data.vehicles:
                vehicle = vehicles_map.get(vehicle_input.vehicle_id)

                if not vehicle:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Машина {vehicle_input.vehicle_id} не найдена"
                    )

                if vehicle["is_deleted"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Машина {vehicle_input.vehicle_id} находится в корзине"
                    )
                
                if not vehicle.get("vin") or not str(vehicle.get("vin")).strip():
                    raise HTTPException(
                        status_code=400,
                        detail=f"У машины {vehicle_input.vehicle_id} не указан VIN. Нельзя создать заявку без VIN"
                    )

                if vehicle["client_id"] != data.client_id:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Машина {vehicle_input.vehicle_id} не принадлежит выбранному клиенту"
                    )
            
            total_price = 0

            if data.price:
                total_price = float(data.price.total_price or 0)

                if total_price < 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Итоговая цена заявки не может быть отрицательной"
                    )

            platform = data.platform.strip()

            if not platform:
                raise HTTPException(
                    status_code=400,
                    detail="Необходимо выбрать платформу мониторинга"
                )

            # шапка заявки
            cursor.execute(
                """
                INSERT INTO requests (
                    client_id,
                    work_type,
                    visit_type,
                    address,
                    city,
                    platform,
                    scheduled_at,
                    status,
                    total_price,
                    created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    data.client_id,
                    data.work_type,
                    data.visit_type,
                    data.address,
                    data.city,
                    platform,
                    data.scheduled_at,
                    "NEW",
                    total_price,
                    current_user["id"],
                )
            )

            request_id = cursor.lastrowid

            # Добавляем автомобили заявки
            request_vehicle_id_by_index = {}

            for index, vehicle_input in enumerate(data.vehicles, start=1):
                has_beacon = bool(vehicle_input.has_beacon) if data.work_type == "INSTALLATION" else False
                has_blocking = bool(vehicle_input.has_blocking) if data.work_type == "INSTALLATION" else False

                cursor.execute(
                    """
                    INSERT INTO request_vehicles (
                        request_id,
                        vehicle_id,
                        has_beacon,
                        has_blocking
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        vehicle_input.vehicle_id,
                        has_beacon,
                        has_blocking,
                    )
                )

                request_vehicle_id = cursor.lastrowid
                request_vehicle_id_by_index[index] = request_vehicle_id

                # Дополнительные датчики сохраняем только для установки
                if data.work_type == "INSTALLATION" and vehicle_input.extra_sensors:
                    for sensor in vehicle_input.extra_sensors:
                        sensor_name = sensor.name.strip()

                        if not sensor_name:
                            continue

                        sensor_price = float(sensor.price or 0)

                        if sensor_price < 0:
                            raise HTTPException(
                                status_code=400,
                                detail="Цена дополнительного датчика не может быть отрицательной"
                            )

                        cursor.execute(
                            """
                            INSERT INTO request_vehicle_extra_sensors (
                                request_vehicle_id,
                                name,
                                price
                            )
                            VALUES (%s, %s, %s)
                            """,
                            (
                                request_vehicle_id,
                                sensor_name,
                                sensor_price
                            )
                        )
            
            saved_total_price = total_price

            if data.price and data.price.lines:
                calculated_total = 0

                for line in data.price.lines:
                    label = line.label.strip()

                    if not label:
                        continue

                    quantity = float(line.quantity or 0)
                    unit_price = float(line.unit_price or 0)
                    total_line_price = float(line.total_price or 0)

                    if quantity <= 0:
                        raise HTTPException(
                            status_code=400,
                            detail="Количество в строке цены должно быть больше 0"
                        )

                    if unit_price < 0 or total_line_price < 0:
                        raise HTTPException(
                            status_code=400,
                            detail="Цена в строке расчёта не может быть отрицательной"
                        )

                    request_vehicle_id = None

                    if line.vehicle_index:
                        request_vehicle_id = request_vehicle_id_by_index.get(line.vehicle_index)

                        if not request_vehicle_id:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Не найден автомобиль заявки для строки цены vehicle_index={line.vehicle_index}"
                            )

                    calculated_total += total_line_price

                    cursor.execute(
                        """
                        INSERT INTO request_price_lines (
                            request_id,
                            request_vehicle_id,
                            line_key,
                            code,
                            label,
                            quantity,
                            unit,
                            unit_price,
                            total_price,
                            source,
                            is_manual
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            request_id,
                            request_vehicle_id,
                            line.line_key,
                            line.code,
                            label,
                            quantity,
                            line.unit or "шт",
                            unit_price,
                            total_line_price,
                            line.source or "base",
                            bool(line.is_manual),
                        )
                    )

                cursor.execute(
                    """
                    UPDATE requests
                    SET total_price = %s
                    WHERE id = %s
                    """,
                    (
                        calculated_total,
                        request_id,
                    )
                )

                saved_total_price = calculated_total

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    new_value
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "CREATED",
                    f"Request created with {len(data.vehicles)} vehicle(s)"
                )
            )
            
            cursor.execute(
                """
                SELECT name, company_name
                FROM clients
                WHERE id = %s
                """,
                (data.client_id,)
            )
            client_for_notification = cursor.fetchone() or {}

            notify_new_request(
                cursor=cursor,
                request_id=request_id,
                city=data.city,
                client_name=client_for_notification.get("name"),
                company_name=client_for_notification.get("company_name"),
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "created",
                "request_id": request_id,
                "vehicles_count": len(data.vehicles),
                "total_price": saved_total_price
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("")
def get_requests(status: str = Query(None), current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            values = []
            conditions = ["r.is_deleted = 0"]

            if status:
                conditions.append("r.status = %s")
                values.append(status)

            role = current_user["role"]

            if role == MANAGER:
                conditions.append(
                    """
                    (
                        r.created_by = %s
                        OR c.responsible_manager_id = %s
                    )
                    """
                )
                values.extend([current_user["id"], current_user["id"]])

            elif role == TECH_SUPPORT:
                conditions.append("r.created_by = %s")
                values.append(current_user["id"])

            elif role == TECHNICIAN:
                user_city = get_current_user_city(cursor, current_user)

                if not user_city:
                    return []

                conditions.append("r.is_paid = 1")
                conditions.append("r.city = %s")
                values.append(user_city)
                conditions.append("(r.assigned_to IS NULL OR r.assigned_to = %s)")
                values.append(current_user["id"])

            elif role in [SENIOR_TECHNICIAN, ADMIN, ROP, ACCOUNTANT]:
                pass

            else:
                return []

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.address,
                    r.city,
                    r.platform,
                    r.scheduled_at,
                    r.status,
                    r.created_at,
                    r.assigned_to,
                    r.is_paid,
                    r.paid_at,
                    r.total_price,
                    r.created_by,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role,

                    c.name AS client_name,
                    c.company_name,
                    c.phone,
                    c.type AS client_type,
                    c.status AS client_status,
                    c.responsible_manager_id,

                    responsible.name AS responsible_manager_name

                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE {where_clause}
                ORDER BY r.created_at DESC
                """,
                tuple(values)
            )

            requests = cursor.fetchall()
            requests = attach_vehicles_to_requests(cursor, requests)
            requests = attach_requests_permissions(requests, current_user)

            if not can_view_price_fields(current_user):
                requests = hide_request_prices(requests)

            return requests

    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_requests(current_user: dict = Depends(get_current_user)):
    """Список удалённых заявок. Только ADMIN."""
    if current_user["role"] not in [ADMIN, ROP]:
        raise HTTPException(
            status_code=403,
            detail="Только Админ или РОП может просматривать корзину заявок"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.address,
                    r.city,
                    r.platform,
                    r.scheduled_at,
                    r.status,
                    r.created_at,
                    r.assigned_to,
                    r.is_paid,
                    r.paid_at,
                    r.total_price,
                    r.deleted_at,
                    r.deleted_by,
                    r.created_by,

                    c.status AS client_status,
                    c.responsible_manager_id,
                    responsible.name AS responsible_manager_name,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role,

                    c.name AS client_name,
                    c.company_name,
                    c.phone,
                    c.type AS client_type,

                    u.name AS deleted_by_name
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN users u ON r.deleted_by = u.id
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE r.is_deleted = 1
                ORDER BY r.deleted_at DESC
                """
            )

            requests = cursor.fetchall()
            return attach_vehicles_to_requests(cursor, requests)

    finally:
        connection.close()

@router.post("/comments")
def create_comment(data: CommentCreate, current_user: dict = Depends(get_current_user)):
    # чтобы монтажники не могли оставлять комментарии, раскомментируй эту проверку:
    # if current_user["role"] == "TECHNICIAN":
    #     raise HTTPException(status_code=403, detail="Обычный монтажник не может оставлять комментарии")
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (data.request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена или удалена")
            
            user_city = None

            if current_user["role"] == TECHNICIAN:
                user_city = get_current_user_city(cursor, current_user)

            if not user_can_access_request(request, current_user, user_city):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для комментирования этой заявки"
                )
            
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
        "COMPLETED": [],
        "CANCELLED": []
    }

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.address,
                    r.city,
                    r.platform,
                    r.scheduled_at,
                    r.status,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,

                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if not user_can_access_request(req, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этой заявки"
                )

            can_edit_this_request = (
                can_edit_all_requests(current_user)
                or (
                    current_user["role"] == MANAGER
                    and (
                        (req.get("created_by") is not None and int(req["created_by"]) == int(current_user["id"]))
                        or (
                            req.get("responsible_manager_id") is not None
                            and int(req["responsible_manager_id"]) == int(current_user["id"])
                        )
                    )
                )
            )

            if not can_edit_this_request and data.status is None:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этой заявки"
                )

            update_fields = []
            update_values = []

            def add_history(action: str, old_value, new_value):
                cursor.execute(
                    """
                    INSERT INTO request_history (
                        request_id,
                        user_id,
                        action,
                        old_value,
                        new_value
                    )
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
            
            # platform
            if data.platform is not None:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                new_platform = data.platform.strip()

                if not new_platform:
                    raise HTTPException(
                        status_code=400,
                        detail="Платформа мониторинга не может быть пустой"
                    )

                add_request_update("platform", new_platform, "PLATFORM_CHANGED")

            # visit_type
            if data.visit_type is not None and data.visit_type != req["visit_type"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                if data.visit_type not in ["IN_OFFICE", "ON_SITE"]:
                    raise HTTPException(status_code=400, detail="Некорректный тип визита")

                add_request_update("visit_type", data.visit_type, "VISIT_TYPE_CHANGED")

            # address
            if data.address is not None and data.address != req["address"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update("address", data.address, "ADDRESS_CHANGED")

            # city
            if data.city is not None and data.city != req["city"]:
                if not can_edit_this_request:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для редактирования этой заявки"
                    )

                add_request_update("city", data.city, "CITY_CHANGED")

            # scheduled_at
            if data.scheduled_at is not None:
                new_scheduled_at = data.scheduled_at.replace(tzinfo=None)

                if req["scheduled_at"] != new_scheduled_at:
                    if not can_edit_this_request:
                        raise HTTPException(
                            status_code=403,
                            detail="Недостаточно прав для редактирования этой заявки"
                        )

                    add_request_update("scheduled_at", new_scheduled_at, "SCHEDULED_AT_CHANGED")

            # payment
            if data.is_paid is not None:
                if current_user["role"] not in [ADMIN, ROP, ACCOUNTANT]:
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав на изменение оплаты заявки"
                    )

                old_paid = bool(req["is_paid"])
                new_paid = bool(data.is_paid)

                if old_paid != new_paid:
                    paid_at_val = datetime.now() if new_paid else None

                    update_fields.append("is_paid = %s")
                    update_values.append(new_paid)

                    update_fields.append("paid_at = %s")
                    update_values.append(paid_at_val)

                    add_history("PAYMENT_UPDATED", f"is_paid={old_paid}", f"is_paid={new_paid}")
                    
                    notify_request_payment_changed(
                        cursor=cursor,
                        request_id=request_id,
                        is_paid=new_paid,
                        actor_user_id=current_user["id"],
                    )

            # status
            if data.status is not None and data.status != req["status"]:
                if not can_change_request_status(current_user):
                    raise HTTPException(
                        status_code=403,
                        detail="Недостаточно прав для изменения статуса"
                    )

                if data.status not in ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]:
                    raise HTTPException(status_code=400, detail="Некорректный статус заявки")

                if current_user["role"] not in [ADMIN, ROP]:
                    allowed = ALLOWED_TRANSITIONS.get(req["status"], [])

                    if data.status not in allowed:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Нельзя сменить {req['status']} на {data.status}"
                        )

                add_request_update("status", data.status, "STATUS_CHANGED")
                
                notify_request_status_changed(
                    cursor=cursor,
                    request_id=request_id,
                    old_status=req["status"],
                    new_status=data.status,
                    assigned_to=req.get("assigned_to"),
                    actor_user_id=current_user["id"],
                )

            if update_fields:
                update_values.append(request_id)

                cursor.execute(
                    f"""
                    UPDATE requests
                    SET {', '.join(update_fields)}
                    WHERE id = %s
                    """,
                    tuple(update_values)
                )

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
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    status,
                    created_by,
                    created_at,
                    is_deleted
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

            can_delete = False

            if can_delete_any_request(current_user):
                can_delete = True

            elif can_delete_own_request_with_time_limit(current_user):
                is_creator = (
                    request.get("created_by") is not None
                    and int(request["created_by"]) == int(current_user["id"])
                )

                if not is_creator:
                    raise HTTPException(
                        status_code=403,
                        detail="Можно удалить только свою заявку"
                    )

                if request["status"] != "NEW":
                    raise HTTPException(
                        status_code=400,
                        detail="Удалить можно только новую заявку"
                    )

                cursor.execute(
                    """
                    SELECT TIMESTAMPDIFF(SECOND, %s, NOW()) AS age_seconds
                    """,
                    (request["created_at"],)
                )
                age = cursor.fetchone()

                age_seconds = int(age.get("age_seconds") or 0)

                if age_seconds > REQUEST_DELETE_TIME_LIMIT_SECONDS:
                    raise HTTPException(
                        status_code=400,
                        detail="Удалить свою заявку можно только в течение 2 минут после создания"
                    )

                can_delete = True

            if not can_delete:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для удаления заявки"
                )

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
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{request_id}/restore")
def restore_request(request_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление заявки из корзины. Только ADMIN или ROP."""
    if current_user["role"] not in [ADMIN, ROP]:
        raise HTTPException(status_code=403, detail="Только Админ или РОП может восстанавливать заявки")

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
    if current_user["role"] not in [ADMIN, ROP, SENIOR_TECHNICIAN]:
        raise HTTPException(status_code=403, detail="Только Старший монтажник, РОП или Админ могут назначать заявки")
    
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

            if not tech or tech["role"] not in [TECHNICIAN, SENIOR_TECHNICIAN]:
                raise HTTPException(
                    status_code=400,
                    detail="Назначить можно только монтажника или старшего монтажника"
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
            
            notify_request_assigned(
                cursor=cursor,
                request_id=request_id,
                technician_id=data.technician_id,
                actor_user_id=current_user["id"],
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

@router.patch("/{request_id}/complete")
def complete_request(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, assigned_to, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            if req["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя завершить удалённую заявку"
                )

            if req["status"] != "IN_PROGRESS":
                raise HTTPException(
                    status_code=400,
                    detail="Завершить можно только заявку в процессе"
                )

            if not req["assigned_to"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя завершить заявку без назначенного исполнителя"
                )

            role = current_user["role"]

            if role == "TECHNICIAN":
                if req["assigned_to"] != current_user["id"]:
                    raise HTTPException(
                        status_code=403,
                        detail="Обычный монтажник может завершить только свою заявку"
                    )

            elif role not in [ADMIN, ROP, SENIOR_TECHNICIAN]:
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для завершения заявки"
                )

            cursor.execute(
                """
                UPDATE requests
                SET status = 'COMPLETED'
                WHERE id = %s
                """,
                (request_id,)
            )

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    old_value,
                    new_value
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "STATUS_CHANGED",
                    "IN_PROGRESS",
                    "COMPLETED"
                )
            )

            notify_request_status_changed(
                cursor=cursor,
                request_id=request_id,
                old_status="IN_PROGRESS",
                new_status="COMPLETED",
                assigned_to=req["assigned_to"],
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Заявка завершена",
                "request_id": request_id,
                "status": "COMPLETED"
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
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.client_id,
                    r.work_type,
                    r.visit_type,
                    r.address,
                    r.city,
                    r.platform,
                    r.scheduled_at,
                    r.status,
                    r.created_at,
                    r.assigned_to,
                    r.is_paid,
                    r.paid_at,
                    r.total_price,
                    r.created_by,
                    c.status AS client_status,
                    c.responsible_manager_id,
                    responsible.name AS responsible_manager_name,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role,

                    c.name AS client_name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.type AS client_type
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                LEFT JOIN users creator ON r.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (request_id,)
            )
            request_data = cursor.fetchone()

            if not request_data:
                raise HTTPException(status_code=404, detail="Request not found")
            
            user_city = None

            if current_user["role"] == TECHNICIAN:
                user_city = get_current_user_city(cursor, current_user)

            if not user_can_access_request(request_data, current_user, user_city):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этой заявки"
                )

            request_data = attach_vehicles_to_requests(cursor, [request_data])[0]
            attach_request_permissions(request_data, current_user)

            cursor.execute(
                """
                SELECT
                    rc.id,
                    u.name AS author,
                    rc.message,
                    rc.created_at
                FROM request_comments rc
                LEFT JOIN users u ON rc.user_id = u.id
                WHERE rc.request_id = %s
                ORDER BY rc.created_at ASC
                """,
                (request_id,)
            )
            comments = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    h.action,
                    h.old_value,
                    h.new_value,
                    h.created_at,
                    u.name AS user_name
                FROM request_history h
                LEFT JOIN users u ON h.user_id = u.id
                WHERE h.request_id = %s
                ORDER BY h.created_at ASC
                """,
                (request_id,)
            )
            history = cursor.fetchall()

            if not can_view_price_fields(current_user):
                request_data["total_price"] = None
                price_lines = []
            else:
                cursor.execute(
                    """
                    SELECT
                        id,
                        request_id,
                        request_vehicle_id,
                        line_key,
                        code,
                        label,
                        quantity,
                        unit,
                        unit_price,
                        total_price,
                        source,
                        is_manual,
                        created_at
                    FROM request_price_lines
                    WHERE request_id = %s
                    ORDER BY id ASC
                    """,
                    (request_id,)
                )

                price_lines = cursor.fetchall()

            request_data["price_lines"] = price_lines

            return {
                "request": request_data,
                "vehicles": request_data["vehicles"],
                "comments": comments,
                "history": history,
                "price_lines": price_lines
            }

    finally:
        connection.close()

@router.get("/{request_id}/comments")
def get_comments(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.city,
                    r.assigned_to,
                    r.is_paid,
                    r.created_by,
                    c.responsible_manager_id
                FROM requests r
                LEFT JOIN clients c ON r.client_id = c.id
                WHERE r.id = %s AND r.is_deleted = 0
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            user_city = None

            if current_user["role"] == TECHNICIAN:
                user_city = get_current_user_city(cursor, current_user)

            if not user_can_access_request(request, current_user, user_city):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра комментариев этой заявки"
                )
            
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

@router.post("/{request_id}/accept")
def accept_request(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Самостоятельное принятие заявки монтажником.
    TECHNICIAN может принять только оплаченную свободную заявку своего города.
    SENIOR_TECHNICIAN может принять свободную заявку без ограничения по городу.
    """
    if current_user["role"] not in [TECHNICIAN, SENIOR_TECHNICIAN]:
        raise HTTPException(
            status_code=403,
            detail="Самостоятельно принять заявку могут только монтажники"
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, role, city
                FROM users
                WHERE id = %s
                """,
                (current_user["id"],)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if current_user["role"] == TECHNICIAN and not user["city"]:
                raise HTTPException(
                    status_code=400,
                    detail="У пользователя не указан город"
                )

            cursor.execute(
                """
                SELECT id, city, status, assigned_to, is_paid, is_deleted
                FROM requests
                WHERE id = %s
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Request not found")

            if request["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя принять удалённую заявку"
                )

            if current_user["role"] == TECHNICIAN and not request["is_paid"]:
                raise HTTPException(
                    status_code=403,
                    detail="Обычный монтажник может принять только оплаченную заявку"
                )

            if current_user["role"] == TECHNICIAN and request["city"] != user["city"]:
                raise HTTPException(
                    status_code=403,
                    detail="Нельзя принять заявку другого города"
                )

            if request["assigned_to"] is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Заявка уже назначена другому монтажнику"
                )

            if request["status"] not in ["NEW"]:
                raise HTTPException(
                    status_code=400,
                    detail="Можно принять только новую заявку"
                )

            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s,
                    status = 'IN_PROGRESS'
                WHERE id = %s
                  AND assigned_to IS NULL
                  AND status = 'NEW'
                """,
                (current_user["id"], request_id)
            )

            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Заявку уже успели принять или изменить"
                )

            cursor.execute(
                """
                INSERT INTO request_history (
                    request_id,
                    user_id,
                    action,
                    old_value,
                    new_value
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    current_user["id"],
                    "SELF_ACCEPTED",
                    "assigned_to=NULL, status=NEW",
                    f"assigned_to={current_user['id']}, status=IN_PROGRESS"
                )
            )

            notify_request_self_accepted(
                cursor=cursor,
                request_id=request_id,
                technician_id=current_user["id"],
                actor_user_id=current_user["id"],
            )

            connection.commit()

            return {
                "message": "Заявка принята",
                "request_id": request_id,
                "assigned_to": current_user["id"],
                "status": "IN_PROGRESS"
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()