from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import VehicleCreate, VehicleUpdate
from app.security import get_current_user

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])

@router.post("")
def create_vehicle(data: VehicleCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["ADMIN", "MANAGER", "TECH_SUPPORT"]:
        raise HTTPException(
            status_code=403,
            detail="Только Менеджер или Админ могут создавать машины"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            vin = data.vin.strip().upper() if data.vin else ""

            if not vin:
                raise HTTPException(
                    status_code=400,
                    detail="VIN обязателен при создании машины"
                )

            cursor.execute(
                """
                SELECT id, brand, model, plate_number
                FROM vehicles
                WHERE vin = %s
                AND is_deleted = 0
                """,
                (vin,)
            )
            existing_vehicle = cursor.fetchone()

            if existing_vehicle:
                raise HTTPException(
                    status_code=400,
                    detail=f"Автомобиль с VIN {vin} уже существует"
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
def get_deleted_vehicles(current_user: dict = Depends(get_current_user)):
    """Список удалённых машин. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Только Менеджер или Админ могут просматривать корзину машин"
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
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
            WHERE v.is_deleted = 1
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
                c.name,
                c.company_name,
                c.type,
                u.name
            ORDER BY v.deleted_at DESC
            """
            cursor.execute(sql)
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

@router.delete("/{vehicle_id}")
def delete_vehicle(vehicle_id: int, current_user: dict = Depends(get_current_user)):
    """Soft delete машины. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут удалять машины")

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
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], vehicle_id)
            )

            connection.commit()

            return {
                "message": "Машина перемещена в корзину",
                "vehicle_id": vehicle_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{vehicle_id}/restore")
def restore_vehicle(vehicle_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление машины из корзины. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут восстанавливать машины")

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
                    deleted_by = NULL
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