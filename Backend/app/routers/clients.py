from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.schemas import ClientCreate, ClientUpdate
from app.security import get_current_user

router = APIRouter(prefix="/clients", tags=["Clients"])

def normalize_text(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def normalize_phone(value: str | None) -> str:
    """
    Только цифры.
    Например: +7 777 123 45 67 -> 77771234567
    """
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def get_client_display_name(client: dict) -> str:
    return client.get("company_name") or client.get("name") or f"ID {client.get('id')}"


def find_duplicate_client(
    cursor,
    client_type: str,
    name: str | None,
    company_name: str | None,
    phone: str | None,
    exclude_client_id: int | None = None,
):
    normalized_phone = normalize_phone(phone)

    if not normalized_phone:
        return None

    if client_type == "INDIVIDUAL":
        normalized_name = normalize_text(name)

        if not normalized_name:
            return None

        sql = """
            SELECT id, type, name, company_name, phone, is_deleted
            FROM clients
            WHERE type = 'INDIVIDUAL'
              AND is_deleted = 0
              AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = %s
              AND LOWER(TRIM(name)) = %s
        """

        params = [normalized_phone, normalized_name]

    else:
        normalized_company_name = normalize_text(company_name)

        if not normalized_company_name:
            return None

        sql = """
            SELECT id, type, name, company_name, phone, is_deleted
            FROM clients
            WHERE type = %s
              AND is_deleted = 0
              AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = %s
              AND LOWER(TRIM(company_name)) = %s
        """

        params = [client_type, normalized_phone, normalized_company_name]

    if exclude_client_id:
        sql += " AND id != %s"
        params.append(exclude_client_id)

    sql += " LIMIT 1"

    cursor.execute(sql, tuple(params))
    return cursor.fetchone()


def raise_duplicate_client_error(duplicate: dict):
    client_name = get_client_display_name(duplicate)

    raise HTTPException(
        status_code=409,
        detail=(
            f"Клиент уже существует: {client_name}, телефон: {duplicate.get('phone')}. "
            "Выберите существующего клиента из списка, а не создавайте нового."
        )
    )

def attach_vehicles_to_requests(cursor, requests: list[dict]) -> list[dict]:
    """
    Добавляет к каждой заявке массив vehicles[] из request_vehicles.
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

    grouped = {}

    for row in rows:
        row["has_beacon"] = bool(row["has_beacon"])
        row["has_blocking"] = bool(row["has_blocking"])

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
        raise HTTPException(
            status_code=403,
            detail="Только Менеджер или Админ могут создавать клиентов"
        )

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            duplicate = find_duplicate_client(
                cursor=cursor,
                client_type=data.type,
                name=data.name,
                company_name=data.company_name,
                phone=data.phone,
            )

            if duplicate:
                raise_duplicate_client_error(duplicate)

            sql = """
                INSERT INTO clients (type, name, company_name, phone, email)
                VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(
                sql,
                (
                    data.type,
                    data.name,
                    data.company_name,
                    data.phone,
                    data.email,
                )
            )

            connection.commit()
            new_id = cursor.lastrowid

            return {
                "id": new_id,
                "message": "client created"
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
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
            
            cursor.execute(
                """
                SELECT type, name, company_name, phone
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            current_client_data = cursor.fetchone()

            next_type = update_data.get("type", current_client_data["type"])
            next_name = update_data.get("name", current_client_data["name"])
            next_company_name = update_data.get(
                "company_name",
                current_client_data["company_name"]
            )
            next_phone = update_data.get("phone", current_client_data["phone"])

            duplicate = find_duplicate_client(
                cursor=cursor,
                client_type=next_type,
                name=next_name,
                company_name=next_company_name,
                phone=next_phone,
                exclude_client_id=client_id,
            )

            if duplicate:
                raise_duplicate_client_error(duplicate)

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
                AND is_deleted = 0
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
            # Проверяем, что клиент существует и не удалён
            cursor.execute(
                """
                SELECT id
                FROM clients
                WHERE id = %s
                  AND is_deleted = 0
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

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
                    r.total_price
                FROM requests r
                WHERE r.client_id = %s
                  AND r.is_deleted = 0
                ORDER BY r.created_at DESC
                """,
                (client_id,)
            )

            requests = cursor.fetchall()
            return attach_vehicles_to_requests(cursor, requests)

    finally:
        connection.close()