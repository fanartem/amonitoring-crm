from fastapi import APIRouter, Depends, HTTPException
from app.database import get_connection
from app.schemas import VehicleCreate, VehicleUpdate
from app.security import get_current_user

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])


@router.post("")
def create_vehicle(data: VehicleCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут создавать машины")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            INSERT INTO vehicles (client_id, brand, model, plate_number, vin, year, type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.client_id,
                data.brand,
                data.model,
                data.plate_number,
                data.vin,
                data.year,
                data.type
            ))
            connection.commit()
            return {"message": "created", "vehicle_id": cursor.lastrowid}
    finally:
        connection.close()

@router.get("")
def get_vehicles(client_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
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
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_vehicles(current_user: dict = Depends(get_current_user)):
    """Список удалённых машин. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут просматривать корзину машин")

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
                u.name AS deleted_by_name,
                COUNT(r.id) AS request_count
            FROM vehicles v
            LEFT JOIN clients c ON v.client_id = c.id
            LEFT JOIN users u ON v.deleted_by = u.id
            LEFT JOIN requests r ON v.id = r.vehicle_id
            WHERE v.is_deleted = 1
            GROUP BY 
                v.id, v.client_id, v.brand, v.model, v.plate_number, v.vin,
                v.year, v.type, v.deleted_at, v.deleted_by, c.name, u.name
            ORDER BY v.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
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

            allowed_fields = ["brand", "model", "plate_number", "vin", "year", "type"]

            updates = []
            values = []

            for field in allowed_fields:
                if field in update_data:
                    updates.append(f"{field} = %s")
                    values.append(update_data[field])

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            if "vin" in update_data and update_data["vin"]:
                cursor.execute(
                    """
                    SELECT id
                    FROM vehicles
                    WHERE vin = %s AND id != %s
                    """,
                    (update_data["vin"], vehicle_id)
                )
                existing_vehicle = cursor.fetchone()

                if existing_vehicle:
                    raise HTTPException(
                        status_code=400,
                        detail="Машина с таким VIN уже существует"
                    )

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
                SELECT COUNT(*) AS active_count
                FROM requests
                WHERE vehicle_id = %s
                AND is_deleted = 0
                AND status IN ('NEW', 'IN_PROGRESS')
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