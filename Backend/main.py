from fastapi import FastAPI
from pydantic import BaseModel
from fastapi import HTTPException
from fastapi import Query

import pymysql

app = FastAPI()

def get_connection():
    return pymysql.connect(
        host="localhost",
        user="root",
        password="root",
        database="crm_db",
        cursorclass=pymysql.cursors.DictCursor
    )

class InstallationDetails(BaseModel):
    has_beacon: bool = False
    has_blocking: bool = False

class RequestCreate(BaseModel):
    client_id: int
    vehicle_id: int
    work_type: str
    visit_type: str
    status: str
    installation: InstallationDetails | None = None

class RequestUpdate(BaseModel):
    status: str | None = None
    user_id: int  # кто делает изменение
    installation: InstallationDetails | None = None  # для обновления деталей установки

class CommentCreate(BaseModel):
    request_id: int
    user_id: int
    message: str

class AssignRequest(BaseModel):
    technician_id: int
    user_id: int  # кто назначает

class ClientCreate(BaseModel):
    type: str  # TOO / IP / INDIVIDUAL
    name: str
    company_name: str | None = None
    phone: str
    email: str | None = None

class VehicleCreate(BaseModel):
    client_id: int
    brand: str
    model: str
    plate_number: str
    vin: str | None = None
    year: int | None = None
    type: str | None = None

@app.post("/requests")
def create_request(data: RequestCreate):
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

            cursor.execute(
                """
                INSERT INTO request_history
                (request_id, user_id, action, new_value)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    request_id,
                    None,  # пока можно None или system
                    "CREATED",
                    "Request created"
                )
            )

            # 2. если это установка — добавляем детали
            if data.work_type == "INSTALLATION" and data.installation:
                cursor.execute(
                    """
                    INSERT INTO installation_details
                    (request_id, has_beacon, has_blocking)
                    VALUES (%s, %s, %s)
                    """,
                    (
                        request_id,
                        data.installation.has_beacon,
                        data.installation.has_blocking
                    )
                )

            connection.commit()

        return {"message": "created", "request_id": request_id}

    finally:
        connection.close()

@app.get("/requests")
def get_requests(status: str = Query(None)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            base_sql = """
            SELECT 
                r.id,
                r.work_type,
                r.visit_type,
                r.status,
                r.created_at,

                c.name AS client_name,
                c.phone,

                v.brand,
                v.model,
                v.plate_number,

                i.has_beacon,
                i.has_blocking

            FROM requests r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN installation_details i ON r.id = i.request_id
            """

            if status:
                base_sql += " WHERE r.status = %s"

            base_sql += " ORDER BY r.created_at DESC"

            if status:
                cursor.execute(base_sql, (status,))
            else:
                cursor.execute(base_sql)

            result = cursor.fetchall()

        return result

    finally:
        connection.close()

@app.patch("/requests/{request_id}")
def update_request(request_id: int, data: RequestUpdate):
    connection = get_connection()

    ALLOWED_TRANSITIONS = {
        "NEW": ["IN_PROGRESS"],
        "IN_PROGRESS": ["DONE"],
        "DONE": []
    }

    try:
        with connection.cursor() as cursor:

            # 1. Проверка пользователя
            cursor.execute(
                "SELECT role FROM users WHERE id = %s",
                (data.user_id,)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            role = user["role"]

            if role not in ["ADMIN", "MANAGER", "SENIOR_TECHNICIAN"]:
                raise HTTPException(status_code=403, detail="Not enough permissions")

            # 2. Получаем заявку
            cursor.execute(
                "SELECT work_type, status FROM requests WHERE id = %s",
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Request not found")

            old_status = req["status"]

            # 3. Проверка workflow (если меняется статус)
            if data.status is not None:

                # если НЕ админ → проверяем переход
                if role != "ADMIN":
                    allowed = ALLOWED_TRANSITIONS.get(old_status, [])

                    if data.status not in allowed:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid status transition: {old_status} → {data.status}"
                        )

                # обновляем статус
                cursor.execute(
                    "UPDATE requests SET status = %s WHERE id = %s",
                    (data.status, request_id)
                )

                # пишем историю
                if old_status != data.status:
                    cursor.execute(
                        """
                        INSERT INTO request_history
                        (request_id, user_id, action, old_value, new_value)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            request_id,
                            data.user_id,
                            "STATUS_CHANGED",
                            old_status,
                            data.status
                        )
                    )

            # 4. installation_details (без изменений логики)
            if data.installation and req["work_type"] == "INSTALLATION":

                cursor.execute(
                    "SELECT has_beacon, has_blocking FROM installation_details WHERE request_id = %s",
                    (request_id,)
                )
                old_install = cursor.fetchone()

                new_value = f"beacon={int(data.installation.has_beacon)}, blocking={int(data.installation.has_blocking)}"

                if old_install:
                    cursor.execute(
                        """
                        UPDATE installation_details
                        SET has_beacon = %s, has_blocking = %s
                        WHERE request_id = %s
                        """,
                        (
                            data.installation.has_beacon,
                            data.installation.has_blocking,
                            request_id
                        )
                    )
                    old_value = f"beacon={old_install['has_beacon']}, blocking={old_install['has_blocking']}"
                else:
                    cursor.execute(
                        """
                        INSERT INTO installation_details
                        (request_id, has_beacon, has_blocking)
                        VALUES (%s, %s, %s)
                        """,
                        (
                            request_id,
                            data.installation.has_beacon,
                            data.installation.has_blocking
                        )
                    )
                    old_value = "none"

                cursor.execute(
                    """
                    INSERT INTO request_history
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        data.user_id,
                        "INSTALLATION_UPDATED",
                        old_value,
                        new_value
                    )
                )

            connection.commit()

        return {"message": "updated"}

    finally:
        connection.close()

@app.post("/comments")
def create_comment(data: CommentCreate):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = """
            INSERT INTO request_comments (request_id, user_id, message)
            VALUES (%s, %s, %s)
            """
            cursor.execute(sql, (
                data.request_id,
                data.user_id,
                data.message
            ))
            connection.commit()

        return {"message": "comment added"}

    finally:
        connection.close()

@app.get("/requests/{request_id}/comments")
def get_comments(request_id: int):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                rc.id,
                u.name AS author,
                rc.message,
                rc.created_at
            FROM request_comments rc
            LEFT JOIN users u ON rc.user_id = u.id
            WHERE rc.request_id = %s
            ORDER BY rc.created_at ASC
            """
            cursor.execute(sql, (request_id,))
            result = cursor.fetchall()

        return result

    finally:
        connection.close()

@app.get("/requests/{request_id}") # Получение полной информации по заявке, включая комментарии
def get_request_detail(request_id: int):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # GET заявки
            sql_request = """
            SELECT 
                r.id,
                r.work_type,
                r.visit_type,
                r.status,
                r.created_at,

                c.name AS client_name,
                c.phone,

                v.brand,
                v.model,
                v.plate_number,

                i.has_beacon,
                i.has_blocking

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

            # GET комментарии
            sql_comments = """
            SELECT id, user_id, message, created_at
            FROM request_comments
            WHERE request_id = %s
            ORDER BY created_at ASC
            """
            cursor.execute(sql_comments, (request_id,))
            comments = cursor.fetchall()

            #GET историю изменений
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

        return {
            "request": request_data,
            "comments": comments,
            "history": history
        }

    finally:
        connection.close()

@app.post("/requests/{request_id}/assign")
def assign_request(request_id: int, data: AssignRequest):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            # 1. Проверяем кто назначает
            cursor.execute(
                "SELECT role FROM users WHERE id = %s",
                (data.user_id,)
            )
            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            if user["role"] not in ["ADMIN", "SENIOR_TECHNICIAN"]:
                raise HTTPException(
                    status_code=403,
                    detail="Not enough permissions"
                )

            # 2. Проверяем техника
            cursor.execute(
                "SELECT role FROM users WHERE id = %s",
                (data.technician_id,)
            )
            tech = cursor.fetchone()

            if not tech:
                raise HTTPException(status_code=404, detail="Technician not found")

            if tech["role"] != "TECHNICIAN":
                raise HTTPException(
                    status_code=400,
                    detail="User is not a technician"
                )

            # 3. Проверяем заявку и берём старый статус
            cursor.execute(
                "SELECT status, assigned_to FROM requests WHERE id = %s",
                (request_id,)
            )
            req = cursor.fetchone()

            if not req:
                raise HTTPException(status_code=404, detail="Request not found")

            old_status = req["status"]
            old_assigned = req["assigned_to"]

            if old_status != "NEW":
                raise HTTPException(
                    status_code=400,
                    detail="Only NEW requests can be assigned"
                )

            # 4. Назначаем
            cursor.execute(
                """
                UPDATE requests
                SET assigned_to = %s, status = 'IN_PROGRESS'
                WHERE id = %s
                """,
                (data.technician_id, request_id)
            )

            # 5. История: ASSIGNED (только если реально изменился исполнитель)
            if old_assigned != data.technician_id:
                cursor.execute(
                    """
                    INSERT INTO request_history
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        data.user_id,
                        "ASSIGNED",
                        f"assigned_to={old_assigned}",
                        f"assigned_to={data.technician_id}"
                    )
                )

            # 6. История: STATUS_CHANGED (только если реально изменился статус)
            if old_status != "IN_PROGRESS":
                cursor.execute(
                    """
                    INSERT INTO request_history
                    (request_id, user_id, action, old_value, new_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        request_id,
                        data.user_id,
                        "STATUS_CHANGED",
                        old_status,
                        "IN_PROGRESS"
                    )
                )

            connection.commit()

        return {"message": "Technician assigned"}

    finally:
        connection.close()
        
@app.post("/clients")
def create_client(data: ClientCreate):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            sql = """
            INSERT INTO clients (type, name, company_name, phone, email)
            VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                data.type,
                data.name,
                data.company_name,
                data.phone,
                data.email
            ))
            connection.commit()

        return {"message": "client created"}

    finally:
        connection.close()

@app.get("/clients")
def get_clients():
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM clients")
            result = cursor.fetchall()

        return result

    finally:
        connection.close()

@app.post("/vehicles")
def create_vehicle(data: VehicleCreate):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            # проверяем клиента
            cursor.execute(
                "SELECT id FROM clients WHERE id = %s",
                (data.client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Client not found")

            sql = """
            INSERT INTO vehicles 
            (client_id, brand, model, plate_number, vin, year, type)
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

        return {"message": "vehicle created"}

    finally:
        connection.close()

@app.get("/vehicles")
def get_vehicles(client_id: int = Query(None)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            if client_id:
                cursor.execute(
                    "SELECT * FROM vehicles WHERE client_id = %s",
                    (client_id,)
                )
            else:
                cursor.execute("SELECT * FROM vehicles")

            result = cursor.fetchall()

        return result

    finally:
        connection.close()