from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_connection
from app.schemas import RequestCreate, RequestUpdate, AssignRequest, CommentCreate
from app.security import get_current_user

router = APIRouter(prefix="/requests", tags=["Requests"])

@router.post("")
def create_request(data: RequestCreate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # 1. создаём заявку
            sql = """
            INSERT INTO requests 
            (client_id, vehicle_id, work_type, visit_type, status)
            VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.client_id,
                data.vehicle_id,
                data.work_type,
                data.visit_type,
                "NEW"
            ))

            request_id = cursor.lastrowid

            # Пишем в историю
            cursor.execute(
                """
                INSERT INTO request_history
                (request_id, user_id, action, new_value)
                VALUES (%s, %s, %s, %s)
                """,
                (request_id, current_user["id"], "CREATED", "Request created")
            )

            # 2. если это установка — добавляем детали
            if data.work_type == "INSTALLATION" and data.installation:
                cursor.execute(
                    """
                    INSERT INTO installation_details
                    (request_id, has_beacon, has_blocking)
                    VALUES (%s, %s, %s)
                    """,
                    (request_id, data.installation.has_beacon, data.installation.has_blocking)
                )

            connection.commit()
            return {"message": "created", "request_id": request_id}
    finally:
        connection.close()

@router.get("")
def get_requests(status: str = Query(None), current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            base_sql = """
            SELECT 
                r.*,
                c.name AS client_name, c.phone,
                v.brand, v.model, v.plate_number,
                i.has_beacon, i.has_blocking
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            """
            if status:
                base_sql += " WHERE r.status = %s"
                base_sql += " ORDER BY r.created_at DESC"
                cursor.execute(base_sql, (status,))
            else:
                base_sql += " ORDER BY r.created_at DESC"
                cursor.execute(base_sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.patch("/{request_id}")
def update_request(request_id: int, data: RequestUpdate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    ALLOWED_TRANSITIONS = {
        "NEW": ["IN_PROGRESS"],
        "IN_PROGRESS": ["DONE"],
        "DONE": []
    }
    ALLOWED_ROLES = ["ADMIN", "SENIOR_TECHNICIAN", "MANAGER", "ACCOUNTANT"]

    try:
        with connection.cursor() as cursor:
            # 1. Проверка прав
            if current_user["role"] not in ALLOWED_ROLES:
                raise HTTPException(status_code=403, detail="Недостаточно прав")

            # 2. Получаем заявку
            cursor.execute("SELECT work_type, status, is_paid FROM requests WHERE id = %s", (request_id,))
            req = cursor.fetchone()
            if not req:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            # --- ЛОГИКА ОПЛАТЫ ---
            if data.is_paid is not None:
                if current_user["role"] in ["ADMIN", "ACCOUNTANT"]:
                    old_paid = bool(req["is_paid"])
                    if old_paid != data.is_paid:
                        paid_at_val = datetime.now() if data.is_paid else None
                        cursor.execute(
                            "UPDATE requests SET is_paid = %s, paid_at = %s WHERE id = %s", 
                            (data.is_paid, paid_at_val, request_id)
                        )
                        cursor.execute(
                            "INSERT INTO request_history (request_id, user_id, action, old_value, new_value) VALUES (%s, %s, %s, %s, %s)",
                            (request_id, current_user["id"], "PAYMENT_UPDATED", f"is_paid={old_paid}", f"is_paid={data.is_paid}")
                        )
                else:
                    raise HTTPException(status_code=403, detail="Только Бухгалтер или Админ могут менять оплату")

            # --- ЛОГИКА СТАТУСА ---
            if data.status is not None:
                if current_user["role"] in ["ACCOUNTANT", "TECHNICIAN"]:
                    raise HTTPException(status_code=403, detail="Недостаточно прав для изменения статуса")
                
                old_status = req["status"]
                if old_status != data.status:
                    # Проверка переходов (кроме админа)
                    if current_user["role"] != "ADMIN":
                        allowed = ALLOWED_TRANSITIONS.get(old_status, [])
                        if data.status not in allowed:
                            raise HTTPException(status_code=400, detail=f"Нельзя сменить {old_status} на {data.status}")

                    cursor.execute("UPDATE requests SET status = %s WHERE id = %s", (data.status, request_id))
                    cursor.execute(
                        "INSERT INTO request_history (request_id, user_id, action, old_value, new_value) VALUES (%s, %s, %s, %s, %s)",
                        (request_id, current_user["id"], "STATUS_CHANGED", old_status, data.status)
                    )

            # --- ЛОГИКА ДЕТАЛЕЙ УСТАНОВКИ ---
            if data.installation:
                if current_user["role"] in ["ACCOUNTANT", "TECHNICIAN"]:
                    raise HTTPException(status_code=403, detail="Недостаточно прав для изменения деталей установки")

                if req["work_type"] == "INSTALLATION":
                    cursor.execute("SELECT has_beacon, has_blocking FROM installation_details WHERE request_id = %s", (request_id,))
                    old_install = cursor.fetchone()
                    
                    new_v = f"beacon={int(data.installation.has_beacon)}, blocking={int(data.installation.has_blocking)}"
                    
                    if old_install:
                        cursor.execute(
                            "UPDATE installation_details SET has_beacon = %s, has_blocking = %s WHERE request_id = %s",
                            (data.installation.has_beacon, data.installation.has_blocking, request_id)
                        )
                        old_v = f"beacon={old_install['has_beacon']}, blocking={old_install['has_blocking']}"
                    else:
                        cursor.execute(
                            "INSERT INTO installation_details (request_id, has_beacon, has_blocking) VALUES (%s, %s, %s)",
                            (request_id, data.installation.has_beacon, data.installation.has_blocking)
                        )
                        old_v = "none"

                    if old_v != new_v:
                        cursor.execute(
                            "INSERT INTO request_history (request_id, user_id, action, old_value, new_value) VALUES (%s, %s, %s, %s, %s)",
                            (request_id, current_user["id"], "INSTALLATION_UPDATED", old_v, new_v)
                        )

            # Сохраняем ВСЕ изменения разом
            connection.commit()
            return {"message": "Request updated successfully"}

    except Exception as e:
        connection.rollback()
        raise e
    finally:
        connection.close()

@router.post("/{request_id}/assign")
def assign_request(request_id: int, data: AssignRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["ADMIN", "SENIOR_TECHNICIAN"]:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверка техника
            cursor.execute("SELECT role FROM users WHERE id = %s", (data.technician_id,))
            tech = cursor.fetchone()
            if not tech or tech["role"] != "TECHNICIAN":
                raise HTTPException(status_code=400, detail="User is not a technician")

            # Проверка заявки
            cursor.execute("SELECT status, assigned_to FROM requests WHERE id = %s", (request_id,))
            req = cursor.fetchone()
            if not req or req["status"] != "NEW":
                raise HTTPException(status_code=400, detail="Only NEW requests can be assigned")

            # Назначаем
            cursor.execute(
                "UPDATE requests SET assigned_to = %s, status = 'IN_PROGRESS' WHERE id = %s",
                (data.technician_id, request_id)
            )

            # Пишем историю
            cursor.execute(
                "INSERT INTO request_history (request_id, user_id, action, old_value, new_value) VALUES (%s, %s, %s, %s, %s)",
                (request_id, current_user["id"], "ASSIGNED", f"assigned_to={req['assigned_to']}", f"assigned_to={data.technician_id}")
            )
            
            connection.commit()
            return {"message": "Technician assigned"}
    finally:
        connection.close()

@router.get("/{request_id}")
def get_request_detail(request_id: int, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Данные заявки
            sql_request = """
            SELECT r.*, c.name AS client_name, c.phone, v.brand, v.model, v.plate_number, i.has_beacon, i.has_blocking
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            WHERE r.id = %s
            """
            cursor.execute(sql_request, (request_id,))
            request_data = cursor.fetchone()
            if not request_data:
                raise HTTPException(status_code=404, detail="Request not found")

            # Комментарии
            cursor.execute(
                "SELECT rc.id, u.name AS author, rc.message, rc.created_at FROM request_comments rc LEFT JOIN users u ON rc.user_id = u.id WHERE rc.request_id = %s ORDER BY rc.created_at ASC",
                (request_id,)
            )
            comments = cursor.fetchall()

            # История
            cursor.execute(
                "SELECT h.action, h.old_value, h.new_value, h.created_at, u.name AS user_name FROM request_history h LEFT JOIN users u ON h.user_id = u.id WHERE h.request_id = %s ORDER BY h.created_at ASC",
                (request_id,)
            )
            history = cursor.fetchall()

            return {"request": request_data, "comments": comments, "history": history}
    finally:
        connection.close()

@router.post("/comments")
def create_comment(data: CommentCreate, current_user: dict = Depends(get_current_user)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO request_comments (request_id, user_id, message) VALUES (%s, %s, %s)",
                (data.request_id, current_user["id"], data.message)
            )
            connection.commit()
        return {"message": "comment added"}
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