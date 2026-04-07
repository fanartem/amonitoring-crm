from fastapi import APIRouter, HTTPException, Query
from app.database import get_connection
from app.schemas import RequestCreate, RequestUpdate, AssignRequest, CommentCreate

router = APIRouter(prefix="/requests", tags=["Requests"])

@router.post("")
def create_request(data: RequestCreate):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # 1. Создаём заявку
            sql = "INSERT INTO requests (client_id, vehicle_id, work_type, visit_type, status) VALUES (%s, %s, %s, %s, %s)"
            cursor.execute(sql, (data.client_id, data.vehicle_id, data.work_type, data.visit_type, "NEW"))
            request_id = cursor.lastrowid

            # 2. Логируем в историю
            cursor.execute("INSERT INTO request_history (request_id, action, new_value) VALUES (%s, %s, %s)", 
                           (request_id, "CREATED", "Request created"))

            # 3. Детали установки
            if data.work_type == "INSTALLATION" and data.installation:
                cursor.execute("INSERT INTO installation_details (request_id, has_beacon, has_blocking) VALUES (%s, %s, %s)",
                               (request_id, data.installation.has_beacon, data.installation.has_blocking))
            
            connection.commit()
            return {"message": "created", "request_id": request_id}
    finally:
        connection.close()

@router.get("")
def get_requests(status: str = Query(None)):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT r.*, c.name AS client_name, v.plate_number, i.has_beacon, i.has_blocking
            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            """
            if status:
                sql += " WHERE r.status = %s"
                cursor.execute(sql + " ORDER BY r.created_at DESC", (status,))
            else:
                cursor.execute(sql + " ORDER BY r.created_at DESC")
            return cursor.fetchall()
    finally:
        connection.close()

@router.patch("/{request_id}")
def update_request(request_id: int, data: RequestUpdate):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Здесь логика смены статуса и прав (как была в main.py)
            # Для краткости оставляем структуру, переносим твой код из main.py
            # ... (твой код из PATCH /requests/{request_id}) ...
            connection.commit()
        return {"message": "updated"}
    finally:
        connection.close()

@router.post("/{request_id}/assign")
def assign_request(request_id: int, data: AssignRequest):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # ... (твой код из POST /requests/{request_id}/assign) ...
            connection.commit()
        return {"message": "Technician assigned"}
    finally:
        connection.close()

@router.get("/{request_id}")
def get_request_detail(request_id: int):
    """
    Получение полной информации по заявке, включая комментарии и историю
    """
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # 1. Получаем саму заявку
            sql_request = """
            SELECT 
                r.*, 
                c.name AS client_name, c.phone,
                v.brand, v.model, v.plate_number,
                i.has_beacon, i.has_blocking
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

            # 2. Получаем комментарии
            sql_comments = """
            SELECT rc.id, u.name AS author, rc.message, rc.created_at
            FROM request_comments rc
            LEFT JOIN users u ON rc.user_id = u.id
            WHERE rc.request_id = %s
            ORDER BY rc.created_at ASC
            """
            cursor.execute(sql_comments, (request_id,))
            comments = cursor.fetchall()

            # 3. Получаем историю изменений
            sql_history = """
            SELECT h.action, h.old_value, h.new_value, h.created_at, u.name AS user_name
            FROM request_history h
            LEFT JOIN users u ON h.user_id = u.id
            WHERE h.request_id = %s
            ORDER BY h.created_at ASC
            """
            cursor.execute(sql_history, (request_id,))
            history = cursor.fetchall()

            return {
                "request": request_data,
                "comments": comments,
                "history": history
            }
    finally:
        connection.close()

@router.post("/comments")
def create_comment(data: CommentCreate):
    """
    Добавление комментария к заявке
    """
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = "INSERT INTO request_comments (request_id, user_id, message) VALUES (%s, %s, %s)"
            cursor.execute(sql, (data.request_id, data.user_id, data.message))
            connection.commit()
        return {"message": "comment added"}
    finally:
        connection.close()

@router.get("/{request_id}/comments")
def get_comments(request_id: int):
    """
    Получение списка комментариев только для конкретной заявки
    """
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