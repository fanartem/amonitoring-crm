from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import VehicleCreate, VehicleUpdate, VehicleClientTransfer, VehicleDeleteRequest
from app.security import get_current_user
from app.permissions import can_create_request_for_client

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])

VEHICLE_DELETE_ROLES = ["ADMIN"]

VEHICLE_TRASH_VIEW_ROLES = [
    "ADMIN",
    "ROP",
    "ACCOUNTANT",
    "MANAGER",
    "WAREHOUSE_MANAGER",
]

VEHICLE_RESTORE_ROLES = ["ADMIN"]

ALLOWED_VEHICLE_DELETE_REASON_TYPES = [
    "EQUIPMENT_REMOVED",
    "SERVICE_STOPPED_SIM_BLOCKED",
    "OTHER",
]

def get_client_display_name(client: dict) -> str:
    if not client:
        return "Клиент не найден"

    return (
        client.get("company_name")
        or client.get("name")
        or f"ID клиента {client.get('id')}"
    )

@router.post("")
def create_vehicle(data: VehicleCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["ADMIN", "ROP", "MANAGER", "TECH_SUPPORT"]:
        raise HTTPException(
            status_code=403,
            detail="Только Админ, РОП, Менеджер и Тех. поддержка могут создавать машины"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # 1. Проверяем клиента ДО проверки VIN и ДО создания машины.
            cursor.execute(
                """
                SELECT
                    id,
                    type,
                    name,
                    company_name,
                    status,
                    created_by,
                    responsible_manager_id,
                    is_deleted
                FROM clients
                WHERE id = %s
                LIMIT 1
                """,
                (data.client_id,)
            )

            client = cursor.fetchone()

            if not client or client["is_deleted"]:
                raise HTTPException(
                    status_code=404,
                    detail="Клиент не найден"
                )

            if not can_create_request_for_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для добавления машины этому клиенту"
                )

            if client.get("status") == "BLOCKED":
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя добавить машину заблокированному клиенту"
                )

            # 2. Только после проверки прав нормализуем и проверяем VIN.
            vin = data.vin.strip().upper() if data.vin else ""

            if not vin:
                raise HTTPException(
                    status_code=400,
                    detail="VIN обязателен при создании машины"
                )

            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    c.name AS client_name,
                    c.company_name AS client_company_name
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.vin = %s
                  AND v.is_deleted = 0
                LIMIT 1
                """,
                (vin,)
            )

            existing_vehicle = cursor.fetchone()

            if existing_vehicle:
                client_name = (
                    existing_vehicle.get("client_company_name")
                    or existing_vehicle.get("client_name")
                    or f"ID клиента {existing_vehicle.get('client_id')}"
                )

                raise HTTPException(
                    status_code=400,
                    detail=f"Автомобиль с VIN {vin} уже существует у клиента: {client_name}"
                )

            sql = """
            INSERT INTO vehicles (client_id, brand, model, plate_number, vin, year, type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """

            cursor.execute(
                sql,
                (
                    data.client_id,
                    data.brand,
                    data.model,
                    data.plate_number,
                    vin,
                    data.year,
                    data.type,
                )
            )

            connection.commit()

            return {
                "message": "created",
                "vehicle_id": cursor.lastrowid
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
def get_vehicles(
    client_id: int,
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS total
                FROM vehicles
                WHERE client_id = %s
                AND is_deleted = 0
                """,
                (client_id,)
            )
            total_row = cursor.fetchone()
            total = int(total_row["total"] or 0)

            if limit is None:
                cursor.execute(
                    """
                    SELECT *
                    FROM vehicles
                    WHERE client_id = %s
                    AND is_deleted = 0
                    ORDER BY id DESC
                    """,
                    (client_id,)
                )

                return cursor.fetchall()

            cursor.execute(
                """
                SELECT *
                FROM vehicles
                WHERE client_id = %s
                AND is_deleted = 0
                ORDER BY id DESC
                LIMIT %s OFFSET %s
                """,
                (client_id, limit, offset)
            )

            items = cursor.fetchall()

            return {
                "items": items,
                "total": total,
                "limit": limit,
                "offset": offset,
            }

    finally:
        connection.close()

@router.get("/search")
def search_vehicles(
    q: str = Query(..., min_length=2),
    limit: int = Query(default=10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """
    Быстрый глобальный поиск автомобилей без загрузки всех машин на фронт.
    Ищет по гос. номеру, VIN, марке, модели, клиенту, компании, телефону, БИН/ИИН.
    """
    search = q.strip()

    if len(search) < 2:
        return []

    like_value = f"%{search}%"
    vin_search = search.upper()

    conditions = [
        "v.is_deleted = 0",
        "c.is_deleted = 0",
        """
        (
            v.plate_number LIKE %s OR
            v.vin LIKE %s OR
            v.brand LIKE %s OR
            v.model LIKE %s OR
            c.name LIKE %s OR
            c.company_name LIKE %s OR
            c.phone LIKE %s OR
            c.bin_iin LIKE %s
        )
        """,
    ]

    values = [
        like_value,
        like_value,
        like_value,
        like_value,
        like_value,
        like_value,
        like_value,
        like_value,
    ]

    if current_user.get("client_access_scope") == "RESPONSIBLE_ONLY":
        conditions.append("c.responsible_manager_id = %s")
        values.append(current_user["id"])

    where_clause = " AND ".join(conditions)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = f"""
            SELECT
                v.id,
                v.client_id,
                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type,

                c.name AS client_name,
                c.company_name,
                c.phone AS client_phone,
                c.bin_iin AS client_bin_iin,
                c.type AS client_type,
                c.status AS client_status,
                c.responsible_manager_id,

                responsible.name AS responsible_manager_name
            FROM vehicles v
            LEFT JOIN clients c ON v.client_id = c.id
            LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
            WHERE {where_clause}
            ORDER BY
                CASE
                    WHEN v.plate_number = %s THEN 1
                    WHEN v.vin = %s THEN 2
                    WHEN v.plate_number LIKE %s THEN 3
                    WHEN v.vin LIKE %s THEN 4
                    WHEN c.bin_iin = %s THEN 5
                    WHEN c.phone = %s THEN 6
                    WHEN c.company_name LIKE %s THEN 7
                    WHEN c.name LIKE %s THEN 8
                    ELSE 9
                END,
                v.id DESC
            LIMIT %s
            """

            values.extend([
                search,
                vin_search,
                like_value,
                like_value,
                search,
                search,
                like_value,
                like_value,
                limit,
            ])

            cursor.execute(sql, tuple(values))
            return cursor.fetchall()

    finally:
        connection.close()

@router.get("/check-vin")
def check_vehicle_vin(vin: str, current_user: dict = Depends(get_current_user)):
    """
    Проверка VIN перед созданием автомобиля.
    Нужна, чтобы фронт мог проверить VIN до создания нового клиента.
    """
    normalized_vin = vin.strip().upper() if vin else None

    if not normalized_vin:
        return {
            "exists": False,
            "vin": None,
            "vehicle": None
        }

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    v.vin,
                    v.is_deleted AS vehicle_is_deleted,

                    c.name AS client_name,
                    c.company_name,
                    c.type AS client_type,
                    c.is_deleted AS client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.vin = %s
                AND v.is_deleted = 0
                LIMIT 1
                """,
                (normalized_vin,)
            )

            vehicle = cursor.fetchone()

            return {
                "exists": vehicle is not None,
                "vin": normalized_vin,
                "vehicle": vehicle
            }

    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_vehicles(
    client_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Список удалённых машин. Просмотр: ADMIN, ROP, ACCOUNTANT, MANAGER, WAREHOUSE_MANAGER."""
    if current_user["role"] not in VEHICLE_TRASH_VIEW_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра корзины машин"
        )

    conditions = ["v.is_deleted = 1"]
    values = []

    if client_id:
        conditions.append("v.client_id = %s")
        values.append(client_id)

    where_clause = " AND ".join(conditions)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = f"""
            SELECT 
                v.id,
                v.client_id,
                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type,
                v.deleted_at,
                v.deleted_by,
                v.delete_reason_type,
                v.delete_reason,

                c.name AS client_name,
                c.company_name,
                c.type AS client_type,

                u.name AS deleted_by_name,

                COUNT(DISTINCT r.id) AS request_count
            FROM vehicles v
            LEFT JOIN clients c ON v.client_id = c.id
            LEFT JOIN users u ON v.deleted_by = u.id
            LEFT JOIN request_vehicles rv ON v.id = rv.vehicle_id
            LEFT JOIN requests r 
                ON rv.request_id = r.id
                AND r.is_deleted = 0
            WHERE {where_clause}
            GROUP BY 
                v.id,
                v.client_id,
                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type,
                v.deleted_at,
                v.deleted_by,
                v.delete_reason_type,
                v.delete_reason,
                c.name,
                c.company_name,
                c.type,
                u.name
            ORDER BY v.deleted_at DESC
            """

            cursor.execute(sql, tuple(values))
            return cursor.fetchall()

    finally:
        connection.close()

@router.get("/{vehicle_id}/page")
def get_vehicle_page(
    vehicle_id: int,
    limit: int = Query(default=20, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    client_id,
                    brand,
                    model,
                    plate_number,
                    vin
                FROM vehicles
                WHERE id = %s
                  AND is_deleted = 0
                LIMIT 1
                """,
                (vehicle_id,)
            )

            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Машина не найдена"
                )

            client_id = vehicle["client_id"]

            cursor.execute(
                """
                SELECT COUNT(*) AS total
                FROM vehicles
                WHERE client_id = %s
                  AND is_deleted = 0
                """,
                (client_id,)
            )
            total_row = cursor.fetchone()
            total = int(total_row["total"] or 0)

            cursor.execute(
                """
                SELECT COUNT(*) AS before_count
                FROM vehicles
                WHERE client_id = %s
                  AND is_deleted = 0
                  AND id > %s
                """,
                (client_id, vehicle_id)
            )
            before_row = cursor.fetchone()
            before_count = int(before_row["before_count"] or 0)

            position = before_count + 1
            page = ((position - 1) // limit) + 1
            offset = (page - 1) * limit

            return {
                "vehicle": vehicle,
                "client_id": client_id,
                "vehicle_id": vehicle_id,
                "total": total,
                "position": position,
                "page": page,
                "limit": limit,
                "offset": offset,
            }

    finally:
        connection.close()

@router.patch("/{vehicle_id}")
def update_vehicle(
    vehicle_id: int,
    data: VehicleUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Редактирование машины. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут редактировать машины")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    v.id,
                    v.client_id,
                    v.is_deleted,
                    c.is_deleted AS client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.id = %s
                """,
                (vehicle_id,)
            )
            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(status_code=404, detail="Машина не найдена")

            if vehicle["is_deleted"]:
                raise HTTPException(status_code=400, detail="Нельзя редактировать машину из корзины")

            if vehicle["client_id"] is None or vehicle["client_is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя редактировать машину: клиент не найден или находится в корзине"
                )

            update_data = data.dict(exclude_unset=True)

            if not update_data:
                return {"message": "Нет данных для обновления"}
            
            if "vin" in update_data:
                new_vin = update_data["vin"].strip().upper() if update_data["vin"] else ""

                if not new_vin:
                    raise HTTPException(
                        status_code=400,
                        detail="VIN обязателен. Нельзя сохранить машину без VIN"
                    )

                cursor.execute(
                    """
                    SELECT id
                    FROM vehicles
                    WHERE vin = %s
                    AND id != %s
                    AND is_deleted = 0
                    """,
                    (new_vin, vehicle_id)
                )
                existing_vehicle = cursor.fetchone()

                if existing_vehicle:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Автомобиль с VIN {new_vin} уже существует"
                    )

                update_data["vin"] = new_vin

            allowed_fields = ["brand", "model", "plate_number", "vin", "year", "type"]

            updates = []
            values = []

            for field in allowed_fields:
                if field in update_data:
                    updates.append(f"{field} = %s")
                    values.append(update_data[field])

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            values.append(vehicle_id)

            sql = f"""
            UPDATE vehicles
            SET {', '.join(updates)}
            WHERE id = %s
            """

            cursor.execute(sql, tuple(values))
            connection.commit()

            return {
                "message": "Машина обновлена",
                "vehicle_id": vehicle_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/{vehicle_id}/transfer-client")
def transfer_vehicle_to_client(
    vehicle_id: int,
    data: VehicleClientTransfer,
    current_user: dict = Depends(get_current_user)
):
    """
    Перенос машины от одного клиента к другому.

    Меняем только vehicles.client_id.
    Старые заявки, request_vehicles и request_equipment не переносим,
    потому что они являются историей работ старого клиента.
    """
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Только Менеджер или Админ могут переносить машины между клиентами"
        )

    reason = (data.reason or "").strip()

    if not reason:
        raise HTTPException(
            status_code=400,
            detail="Необходимо указать причину переноса"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.brand,
                    v.model,
                    v.plate_number,
                    v.vin,
                    v.is_deleted,

                    old_client.id AS old_client_id,
                    old_client.type AS old_client_type,
                    old_client.name AS old_client_name,
                    old_client.company_name AS old_client_company_name,
                    old_client.status AS old_client_status,
                    old_client.created_by AS old_client_created_by,
                    old_client.responsible_manager_id AS old_client_responsible_manager_id,
                    old_client.is_deleted AS old_client_is_deleted
                FROM vehicles v
                LEFT JOIN clients old_client ON v.client_id = old_client.id
                WHERE v.id = %s
                LIMIT 1
                """,
                (vehicle_id,)
            )

            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Машина не найдена"
                )

            if vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя переносить машину из корзины"
                )

            if not vehicle["old_client_id"] or vehicle["old_client_is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя перенести машину: текущий клиент не найден или находится в корзине"
                )

            old_client = {
                "id": vehicle["old_client_id"],
                "type": vehicle["old_client_type"],
                "name": vehicle["old_client_name"],
                "company_name": vehicle["old_client_company_name"],
                "status": vehicle["old_client_status"],
                "created_by": vehicle["old_client_created_by"],
                "responsible_manager_id": vehicle["old_client_responsible_manager_id"],
                "is_deleted": vehicle["old_client_is_deleted"],
            }

            if not can_create_request_for_client(old_client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для переноса машины от текущего клиента"
                )

            if int(vehicle["client_id"]) == int(data.new_client_id):
                raise HTTPException(
                    status_code=400,
                    detail="Машина уже находится у выбранного клиента"
                )

            cursor.execute(
                """
                SELECT
                    id,
                    type,
                    name,
                    company_name,
                    status,
                    created_by,
                    responsible_manager_id,
                    is_deleted
                FROM clients
                WHERE id = %s
                LIMIT 1
                """,
                (data.new_client_id,)
            )

            new_client = cursor.fetchone()

            if not new_client or new_client["is_deleted"]:
                raise HTTPException(
                    status_code=404,
                    detail="Новый клиент не найден"
                )

            if not can_create_request_for_client(new_client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для переноса машины к выбранному клиенту"
                )

            if new_client.get("status") == "BLOCKED":
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя перенести машину к заблокированному клиенту"
                )

            cursor.execute(
                """
                SELECT COUNT(DISTINCT rv.request_id) AS request_count
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                WHERE rv.vehicle_id = %s
                  AND r.is_deleted = 0
                """,
                (vehicle_id,)
            )
            request_count_row = cursor.fetchone()
            request_count = int(request_count_row["request_count"] or 0)

            cursor.execute(
                """
                SELECT COUNT(re.id) AS equipment_count
                FROM request_equipment re
                INNER JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                INNER JOIN requests r ON rv.request_id = r.id
                WHERE rv.vehicle_id = %s
                  AND r.is_deleted = 0
                """,
                (vehicle_id,)
            )
            equipment_count_row = cursor.fetchone()
            equipment_count = int(equipment_count_row["equipment_count"] or 0)

            old_client_id = int(vehicle["client_id"])
            new_client_id = int(data.new_client_id)

            cursor.execute(
                """
                UPDATE vehicles
                SET client_id = %s
                WHERE id = %s
                """,
                (new_client_id, vehicle_id)
            )

            cursor.execute(
                """
                INSERT INTO vehicle_transfer_history (
                    vehicle_id,
                    old_client_id,
                    new_client_id,
                    reason,
                    created_by
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    vehicle_id,
                    old_client_id,
                    new_client_id,
                    reason,
                    current_user["id"],
                )
            )

            history_id = cursor.lastrowid

            connection.commit()

            return {
                "message": "Машина перенесена к другому клиенту",
                "vehicle_id": vehicle_id,
                "old_client_id": old_client_id,
                "old_client_name": get_client_display_name({
                    "id": old_client_id,
                    "name": vehicle["old_client_name"],
                    "company_name": vehicle["old_client_company_name"],
                }),
                "new_client_id": new_client_id,
                "new_client_name": get_client_display_name(new_client),
                "reason": reason,
                "history_id": history_id,
                "historical_requests_left_unchanged": request_count,
                "equipment_links_left_unchanged": equipment_count,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/{vehicle_id}/transfer-history")
def get_vehicle_transfer_history(
    vehicle_id: int,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Только Менеджер или Админ могут просматривать историю переноса машины"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    v.id,
                    v.client_id,
                    v.is_deleted,

                    c.id AS current_client_id,
                    c.type AS current_client_type,
                    c.name AS current_client_name,
                    c.company_name AS current_client_company_name,
                    c.created_by,
                    c.responsible_manager_id,
                    c.is_deleted AS current_client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.id = %s
                LIMIT 1
                """,
                (vehicle_id,)
            )

            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Машина не найдена"
                )

            if vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Машина находится в корзине"
                )

            current_client = {
                "id": vehicle["current_client_id"],
                "type": vehicle["current_client_type"],
                "name": vehicle["current_client_name"],
                "company_name": vehicle["current_client_company_name"],
                "created_by": vehicle["created_by"],
                "responsible_manager_id": vehicle["responsible_manager_id"],
                "is_deleted": vehicle["current_client_is_deleted"],
            }

            if not can_create_request_for_client(current_client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра истории переноса этой машины"
                )

            cursor.execute(
                """
                SELECT
                    h.id,
                    h.vehicle_id,
                    h.old_client_id,
                    old_client.type AS old_client_type,
                    old_client.name AS old_client_name,
                    old_client.company_name AS old_client_company_name,

                    h.new_client_id,
                    new_client.type AS new_client_type,
                    new_client.name AS new_client_name,
                    new_client.company_name AS new_client_company_name,

                    h.reason,
                    h.created_by,
                    creator.name AS created_by_name,
                    h.created_at
                FROM vehicle_transfer_history h
                LEFT JOIN clients old_client ON h.old_client_id = old_client.id
                LEFT JOIN clients new_client ON h.new_client_id = new_client.id
                LEFT JOIN users creator ON h.created_by = creator.id
                WHERE h.vehicle_id = %s
                ORDER BY h.created_at DESC, h.id DESC
                """,
                (vehicle_id,)
            )

            rows = cursor.fetchall()

            for row in rows:
                row["old_client_display_name"] = get_client_display_name({
                    "id": row["old_client_id"],
                    "name": row["old_client_name"],
                    "company_name": row["old_client_company_name"],
                })

                row["new_client_display_name"] = get_client_display_name({
                    "id": row["new_client_id"],
                    "name": row["new_client_name"],
                    "company_name": row["new_client_company_name"],
                })

            return rows

    finally:
        connection.close()

@router.delete("/{vehicle_id}")
def delete_vehicle(
    vehicle_id: int,
    data: VehicleDeleteRequest,
    current_user: dict = Depends(get_current_user)
):
    """Soft delete машины. Только ADMIN."""
    if current_user["role"] not in VEHICLE_DELETE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Только Админ может удалять машины"
        )

    delete_reason_type = (data.delete_reason_type or "").strip()
    delete_reason = (data.delete_reason or "").strip()

    if delete_reason_type not in ALLOWED_VEHICLE_DELETE_REASON_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный тип причины удаления машины"
        )

    if not delete_reason:
        raise HTTPException(
            status_code=400,
            detail="Необходимо указать причину удаления машины"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, brand, model, plate_number, is_deleted
                FROM vehicles
                WHERE id = %s
                """,
                (vehicle_id,)
            )
            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(status_code=404, detail="Машина не найдена")

            if vehicle["is_deleted"]:
                raise HTTPException(status_code=400, detail="Машина уже удалена")

            cursor.execute(
                """
                SELECT COUNT(DISTINCT r.id) AS active_count
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                WHERE rv.vehicle_id = %s
                AND r.is_deleted = 0
                AND r.status IN ('NEW', 'IN_PROGRESS')
                """,
                (vehicle_id,)
            )
            result = cursor.fetchone()

            if result["active_count"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить машину: по ней есть активные заявки"
                )

            cursor.execute(
                """
                UPDATE vehicles
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s,
                    delete_reason_type = %s,
                    delete_reason = %s
                WHERE id = %s
                """,
                (
                    current_user["id"],
                    delete_reason_type,
                    delete_reason,
                    vehicle_id,
                )
            )

            connection.commit()

            return {
                "message": "Машина перемещена в корзину",
                "vehicle_id": vehicle_id,
                "delete_reason_type": delete_reason_type,
                "delete_reason": delete_reason,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{vehicle_id}/restore")
def restore_vehicle(vehicle_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление машины из корзины. Только ADMIN и MANAGER."""
    if current_user["role"] not in VEHICLE_RESTORE_ROLES:
        raise HTTPException(status_code=403, detail="Только Админы могут восстанавливать машины")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    v.id,
                    v.client_id,
                    v.is_deleted,
                    c.is_deleted AS client_is_deleted
                FROM vehicles v
                LEFT JOIN clients c ON v.client_id = c.id
                WHERE v.id = %s
                """,
                (vehicle_id,)
            )
            vehicle = cursor.fetchone()

            if not vehicle:
                raise HTTPException(status_code=404, detail="Машина не найдена")

            if not vehicle["is_deleted"]:
                raise HTTPException(status_code=400, detail="Машина не находится в корзине")

            if vehicle["client_id"] is None or vehicle["client_is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя восстановить машину: клиент не найден или находится в корзине"
                )

            cursor.execute(
                """
                UPDATE vehicles
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    delete_reason_type = NULL,
                    delete_reason = NULL
                WHERE id = %s
                """,
                (vehicle_id,)
            )

            connection.commit()

            return {
                "message": "Машина восстановлена",
                "vehicle_id": vehicle_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()