from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.schemas import ClientCreate, ClientUpdate
from app.security import get_current_user

router = APIRouter(prefix="/clients", tags=["Clients"])

@router.get("")
def get_clients(current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                c.id,
                c.type,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.created_at,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by,
                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN requests r 
                ON c.id = r.client_id 
                AND r.is_deleted = 0
            WHERE c.is_deleted = 0
            GROUP BY 
                c.id,
                c.type,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.created_at,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by
            ORDER BY c.created_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    # Только Админ и Менеджер могут создавать базу клиентов
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут создавать клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """INSERT INTO clients (type, name, company_name, phone, email) 
                     VALUES (%s, %s, %s, %s, %s)"""
            cursor.execute(sql, (data.type, data.name, data.company_name, data.phone, data.email))
            connection.commit()
            new_id = cursor.lastrowid 
            return {"id": new_id, "message": "client created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_clients(current_user: dict = Depends(get_current_user)):
    """Список удалённых клиентов. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может просматривать корзину клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                c.id,
                c.type,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.created_at,
                c.deleted_at,
                c.deleted_by,
                u.name AS deleted_by_name,
                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN users u ON c.deleted_by = u.id
            LEFT JOIN requests r ON c.id = r.client_id
            WHERE c.is_deleted = 1
            GROUP BY 
                c.id, c.type, c.name, c.company_name, c.phone, c.email,
                c.created_at, c.deleted_at, c.deleted_by, u.name
            ORDER BY c.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.patch("/{client_id}")
def update_client(
    client_id: int,
    data: ClientUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Редактирование клиента. Только ADMIN и MANAGER."""
    if current_user["role"] not in ["ADMIN", "MANAGER"]:
        raise HTTPException(status_code=403, detail="Только Менеджер или Админ могут редактировать клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(status_code=400, detail="Нельзя редактировать клиента из корзины")

            update_data = data.dict(exclude_unset=True)

            if not update_data:
                return {"message": "Нет данных для обновления"}

            allowed_fields = ["type", "name", "company_name", "phone", "email"]

            updates = []
            values = []

            for field in allowed_fields:
                if field in update_data:
                    updates.append(f"{field} = %s")
                    values.append(update_data[field])

            if not updates:
                return {"message": "Нет допустимых полей для обновления"}

            values.append(client_id)

            sql = f"""
            UPDATE clients
            SET {', '.join(updates)}
            WHERE id = %s
            """

            cursor.execute(sql, tuple(values))
            connection.commit()

            return {
                "message": "Клиент обновлён",
                "client_id": client_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/{client_id}")
def delete_client(client_id: int, current_user: dict = Depends(get_current_user)):
    """Soft delete клиента. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может удалять клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли клиент
            cursor.execute(
                """
                SELECT id, name, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(status_code=400, detail="Клиент уже удалён")

            # Проверяем активные заявки клиента
            cursor.execute(
                """
                SELECT COUNT(*) AS active_count
                FROM requests
                WHERE client_id = %s
                AND status IN ('NEW', 'IN_PROGRESS')
                """,
                (client_id,)
            )
            result = cursor.fetchone()

            if result["active_count"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить клиента: у него есть активные заявки"
                )

            # Soft delete
            cursor.execute(
                """
                UPDATE clients
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], client_id)
            )

            connection.commit()

            return {
                "message": "Клиент перемещён в корзину",
                "client_id": client_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/restore")
def restore_client(client_id: int, current_user: dict = Depends(get_current_user)):
    """Восстановление клиента из корзины. Только ADMIN."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Только Админ может восстанавливать клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if not client["is_deleted"]:
                raise HTTPException(status_code=400, detail="Клиент не находится в корзине")

            cursor.execute(
                """
                UPDATE clients
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (client_id,)
            )

            connection.commit()

            return {
                "message": "Клиент восстановлен",
                "client_id": client_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/{client_id}/requests")
def get_client_requests(client_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
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

                v.brand,
                v.model,
                v.plate_number,
                v.vin,
                v.year,
                v.type AS vehicle_type,

                i.has_beacon,
                i.has_blocking
            FROM requests r
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            WHERE r.client_id = %s
              AND r.is_deleted = 0
            ORDER BY r.created_at DESC
            """
            cursor.execute(sql, (client_id,))
            return cursor.fetchall()
    finally:
        connection.close()