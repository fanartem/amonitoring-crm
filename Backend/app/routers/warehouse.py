from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from io import StringIO
import csv

from app.database import get_connection
from app.security import get_current_user
from app.schemas import WarehouseItemCreate, WarehouseItemUpdate, RequestEquipmentAttach


router = APIRouter(prefix="/warehouse", tags=["Warehouse"])


WAREHOUSE_MANAGE_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"]
WAREHOUSE_READ_ROLES = ["ADMIN", "WAREHOUSE_MANAGER", "MANAGER", "SENIOR_TECHNICIAN", "TECHNICIAN"]


ALLOWED_CATEGORIES = [
    "GPS_TRACKER",
    "BEACON",
    "FUEL_SENSOR",
    "BLE_SENSOR",
    "WIRED_SENSOR",
    "RELAY",
    "CABLE",
    "OTHER",
]

ALLOWED_IDENTIFIER_TYPES = [
    "IMEI",
    "MAC",
    "SERIAL",
    "NONE",
    "OTHER",
]

ALLOWED_STATUSES = [
    "IN_STOCK",
    "RESERVED",
    "INSTALLED",
    "WRITTEN_OFF",
]


def require_warehouse_read(current_user: dict):
    if current_user["role"] not in WAREHOUSE_READ_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра склада")


def require_warehouse_manage(current_user: dict):
    if current_user["role"] not in WAREHOUSE_MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав для управления складом")


def validate_warehouse_item(data: dict):
    category = data.get("category")
    identifier_type = data.get("identifier_type", "NONE")
    identifier_value = data.get("identifier_value")
    is_serialized = data.get("is_serialized", True)
    quantity = data.get("quantity", 1)

    if category is not None and category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Некорректная категория оборудования")

    if identifier_type is not None and identifier_type not in ALLOWED_IDENTIFIER_TYPES:
        raise HTTPException(status_code=400, detail="Некорректный тип идентификатора")

    if quantity is not None and quantity < 0:
        raise HTTPException(status_code=400, detail="Количество не может быть отрицательным")

    if is_serialized:
        if quantity != 1:
            raise HTTPException(status_code=400, detail="У серийного оборудования quantity должен быть 1")

        if identifier_type == "NONE":
            raise HTTPException(status_code=400, detail="Для серийного оборудования нужен identifier_type")

        if not identifier_value:
            raise HTTPException(status_code=400, detail="Для серийного оборудования нужен identifier_value")

    if not is_serialized:
        if identifier_type == "NONE":
            return

        if identifier_type != "NONE" and identifier_value:
            raise HTTPException(
                status_code=400,
                detail="Несерийное оборудование не должно иметь уникальный identifier_value"
            )

def parse_bool(value):
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    value = str(value).strip().lower()

    if value in ["true", "1", "yes", "y", "да"]:
        return True

    if value in ["false", "0", "no", "n", "нет", ""]:
        return False

    raise HTTPException(status_code=400, detail=f"Некорректное boolean значение: {value}")

def parse_int(value, default=0):
    if value is None or str(value).strip() == "":
        return default

    try:
        return int(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Некорректное числовое значение: {value}")

@router.get("/template")
def download_warehouse_template(current_user: dict = Depends(get_current_user)):
    """
    Скачать CSV-шаблон для импорта оборудования.
    """
    require_warehouse_manage(current_user)

    output = StringIO()

    writer = csv.writer(output, delimiter=";")

    writer.writerow([
        "category",
        "name",
        "manufacturer",
        "model",
        "identifier_type",
        "identifier_value",
        "serial_number",
        "is_serialized",
        "quantity",
        "note"
    ])

    writer.writerow([
        "GPS_TRACKER",
        "Teltonika FMC920",
        "Teltonika",
        "FMC920",
        "IMEI",
        "352093087123456",
        "",
        "true",
        "1",
        "Основной GPS-трекер"
    ])

    writer.writerow([
        "BLE_SENSOR",
        "ADM35",
        "ADM",
        "ADM35",
        "MAC",
        "AA:BB:CC:DD:EE:FF",
        "",
        "true",
        "1",
        "BLE-датчик"
    ])

    writer.writerow([
        "RELAY",
        "Реле блокировки",
        "",
        "",
        "NONE",
        "",
        "",
        "false",
        "50",
        "Расходник"
    ])

    response = Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8"
    )

    response.headers["Content-Disposition"] = "attachment; filename=warehouse_import_template.csv"

    return response

@router.post("/import")
async def import_warehouse_items(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Импорт оборудования из CSV.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Поддерживается только CSV-файл")

    content = await file.read()

    try:
        decoded_content = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV должен быть в кодировке UTF-8")

    csv_file = StringIO(decoded_content)

    try:
        sample = decoded_content[:2048]
        dialect = csv.Sniffer().sniff(sample, delimiters=";,")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"

    csv_file.seek(0)
    reader = csv.DictReader(csv_file, dialect=dialect)

    required_columns = [
        "category",
        "name",
        "manufacturer",
        "model",
        "identifier_type",
        "identifier_value",
        "serial_number",
        "is_serialized",
        "quantity",
        "note",
    ]

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV-файл пустой или не содержит заголовков")

    missing_columns = [col for col in required_columns if col not in reader.fieldnames]

    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"В CSV отсутствуют колонки: {', '.join(missing_columns)}"
        )

    rows = list(reader)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV не содержит строк для импорта")

    imported_count = 0
    skipped_count = 0
    errors = []

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            for index, row in enumerate(rows, start=2):
                try:
                    category = (row.get("category") or "").strip()
                    name = (row.get("name") or "").strip()
                    manufacturer = (row.get("manufacturer") or "").strip() or None
                    model = (row.get("model") or "").strip() or None
                    identifier_type = (row.get("identifier_type") or "NONE").strip() or "NONE"
                    identifier_value = (row.get("identifier_value") or "").strip() or None
                    serial_number = (row.get("serial_number") or "").strip() or None
                    is_serialized = parse_bool(row.get("is_serialized"))
                    quantity = parse_int(row.get("quantity"), default=1)
                    note = (row.get("note") or "").strip() or None

                    item_data = {
                        "category": category,
                        "name": name,
                        "manufacturer": manufacturer,
                        "model": model,
                        "identifier_type": identifier_type,
                        "identifier_value": identifier_value,
                        "serial_number": serial_number,
                        "is_serialized": is_serialized,
                        "quantity": quantity,
                        "note": note,
                    }

                    if not name:
                        raise HTTPException(status_code=400, detail="name обязателен")

                    validate_warehouse_item(item_data)

                    if identifier_value:
                        cursor.execute(
                            """
                            SELECT id
                            FROM warehouse_items
                            WHERE identifier_type = %s
                            AND identifier_value = %s
                            """,
                            (identifier_type, identifier_value)
                        )
                        existing = cursor.fetchone()

                        if existing:
                            skipped_count += 1
                            errors.append({
                                "row": index,
                                "error": "Оборудование с таким идентификатором уже существует",
                                "identifier_type": identifier_type,
                                "identifier_value": identifier_value,
                            })
                            continue

                    cursor.execute(
                        """
                        INSERT INTO warehouse_items (
                            category,
                            name,
                            manufacturer,
                            model,
                            identifier_type,
                            identifier_value,
                            serial_number,
                            is_serialized,
                            quantity,
                            status,
                            note,
                            created_by
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            category,
                            name,
                            manufacturer,
                            model,
                            identifier_type,
                            identifier_value,
                            serial_number,
                            is_serialized,
                            quantity,
                            "IN_STOCK",
                            note,
                            current_user["id"],
                        )
                    )

                    imported_count += 1

                except HTTPException as e:
                    skipped_count += 1
                    errors.append({
                        "row": index,
                        "error": e.detail
                    })
                except Exception as e:
                    skipped_count += 1
                    errors.append({
                        "row": index,
                        "error": str(e)
                    })

            connection.commit()

            return {
                "message": "Импорт завершён",
                "imported_count": imported_count,
                "skipped_count": skipped_count,
                "errors": errors
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/items")
def get_warehouse_items(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Список оборудования на складе.
    Доступ: ADMIN, WAREHOUSE_MANAGER, MANAGER.
    """
    require_warehouse_read(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                wi.id,
                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.quantity,
                wi.status,
                wi.note,
                wi.created_at,
                wi.updated_at,
                u.name AS created_by_name
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.created_by = u.id
            WHERE wi.is_deleted = 0
            """
            values = []

            if category:
                sql += " AND wi.category = %s"
                values.append(category)

            if status:
                sql += " AND wi.status = %s"
                values.append(status)

            if search:
                sql += """
                AND (
                    wi.name LIKE %s OR
                    wi.manufacturer LIKE %s OR
                    wi.model LIKE %s OR
                    wi.identifier_value LIKE %s OR
                    wi.serial_number LIKE %s
                )
                """
                like_value = f"%{search}%"
                values.extend([like_value, like_value, like_value, like_value, like_value])

            sql += " ORDER BY wi.created_at DESC"

            cursor.execute(sql, tuple(values))
            return cursor.fetchall()
    finally:
        connection.close()

@router.post("/items")
def create_warehouse_item(
    data: WarehouseItemCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Добавить оборудование на склад.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    item_data = data.dict()
    validate_warehouse_item(item_data)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            if data.identifier_value:
                cursor.execute(
                    """
                    SELECT id
                    FROM warehouse_items
                    WHERE identifier_type = %s
                    AND identifier_value = %s
                    """,
                    (data.identifier_type, data.identifier_value)
                )
                existing = cursor.fetchone()

                if existing:
                    raise HTTPException(
                        status_code=400,
                        detail="Оборудование с таким идентификатором уже существует"
                    )

            sql = """
            INSERT INTO warehouse_items (
                category,
                name,
                manufacturer,
                model,
                identifier_type,
                identifier_value,
                serial_number,
                is_serialized,
                quantity,
                status,
                note,
                created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """

            cursor.execute(sql, (
                data.category,
                data.name,
                data.manufacturer,
                data.model,
                data.identifier_type,
                data.identifier_value,
                data.serial_number,
                data.is_serialized,
                data.quantity,
                "IN_STOCK",
                data.note,
                current_user["id"],
            ))

            connection.commit()

            return {
                "message": "Оборудование добавлено на склад",
                "item_id": cursor.lastrowid
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/items/{item_id}")
def update_warehouse_item(
    item_id: int,
    data: WarehouseItemUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Редактировать оборудование.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    update_data = data.dict(exclude_unset=True)

    if not update_data:
        return {"message": "Нет данных для обновления"}

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Нельзя редактировать оборудование из корзины")

            merged_data = dict(item)
            merged_data.update(update_data)
            validate_warehouse_item(merged_data)

            if "status" in update_data and update_data["status"] not in ALLOWED_STATUSES:
                raise HTTPException(status_code=400, detail="Некорректный статус оборудования")

            if "identifier_value" in update_data or "identifier_type" in update_data:
                identifier_type = merged_data.get("identifier_type")
                identifier_value = merged_data.get("identifier_value")

                if identifier_value:
                    cursor.execute(
                        """
                        SELECT id
                        FROM warehouse_items
                        WHERE identifier_type = %s
                        AND identifier_value = %s
                        AND id != %s
                        """,
                        (identifier_type, identifier_value, item_id)
                    )
                    existing = cursor.fetchone()

                    if existing:
                        raise HTTPException(
                            status_code=400,
                            detail="Оборудование с таким идентификатором уже существует"
                        )

            allowed_fields = [
                "category",
                "name",
                "manufacturer",
                "model",
                "identifier_type",
                "identifier_value",
                "serial_number",
                "is_serialized",
                "quantity",
                "status",
                "note",
            ]

            updates = []
            values = []

            for field in allowed_fields:
                if field in update_data:
                    updates.append(f"{field} = %s")
                    values.append(update_data[field])

            updates.append("updated_at = NOW()")

            values.append(item_id)

            sql = f"""
            UPDATE warehouse_items
            SET {', '.join(updates)}
            WHERE id = %s
            """

            cursor.execute(sql, tuple(values))
            connection.commit()

            return {
                "message": "Оборудование обновлено",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/items/{item_id}")
def delete_warehouse_item(
    item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Soft delete оборудования.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Оборудование уже в корзине")

            if item["status"] in ["RESERVED", "INSTALLED"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить оборудование, которое зарезервировано или установлено"
                )

            cursor.execute(
                """
                UPDATE warehouse_items
                SET is_deleted = 1,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], item_id)
            )

            connection.commit()

            return {
                "message": "Оборудование перемещено в корзину",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/deleted")
def get_deleted_warehouse_items(current_user: dict = Depends(get_current_user)):
    """
    Корзина склада.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
            SELECT 
                wi.id,
                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.quantity,
                wi.status,
                wi.note,
                wi.deleted_at,
                wi.deleted_by,
                u.name AS deleted_by_name
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.deleted_by = u.id
            WHERE wi.is_deleted = 1
            ORDER BY wi.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.patch("/items/{item_id}/restore")
def restore_warehouse_item(
    item_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Восстановить оборудование из корзины.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, is_deleted
                FROM warehouse_items
                WHERE id = %s
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if not item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Оборудование не находится в корзине")

            cursor.execute(
                """
                UPDATE warehouse_items
                SET is_deleted = 0,
                    deleted_at = NULL,
                    deleted_by = NULL
                WHERE id = %s
                """,
                (item_id,)
            )

            connection.commit()

            return {
                "message": "Оборудование восстановлено",
                "item_id": item_id
            }

    except HTTPException:
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/requests/{request_id}/equipment")
def attach_equipment_to_request(
    request_id: int,
    data: RequestEquipmentAttach,
    current_user: dict = Depends(get_current_user)
):
    """
    Привязать оборудование к заявке и списать со склада.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем заявку
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
                raise HTTPException(status_code=400, detail="Нельзя привязать оборудование к удалённой заявке")

            # Проверяем оборудование
            cursor.execute(
                """
                SELECT 
                    id,
                    category,
                    name,
                    manufacturer,
                    model,
                    identifier_type,
                    identifier_value,
                    is_serialized,
                    quantity,
                    status,
                    is_deleted
                FROM warehouse_items
                WHERE id = %s
                """,
                (data.warehouse_item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(status_code=400, detail="Нельзя привязать оборудование из корзины")

            if item["status"] != "IN_STOCK":
                raise HTTPException(status_code=400, detail="Оборудование недоступно на складе")

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                # На всякий случай проверяем, не было ли уже привязано
                cursor.execute(
                    """
                    SELECT id
                    FROM request_equipment
                    WHERE warehouse_item_id = %s
                    """,
                    (data.warehouse_item_id,)
                )
                existing_link = cursor.fetchone()

                if existing_link:
                    raise HTTPException(
                        status_code=400,
                        detail="Это серийное оборудование уже привязано к заявке"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'INSTALLED',
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.warehouse_item_id,)
                )

            else:
                available_quantity = int(item["quantity"])

                if data.quantity > available_quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно оборудования на складе. Доступно: {available_quantity}"
                    )

                new_quantity = available_quantity - data.quantity

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_quantity, data.warehouse_item_id)
                )

            # Создаём связь заявки и оборудования
            cursor.execute(
                """
                INSERT INTO request_equipment (
                    request_id,
                    warehouse_item_id,
                    quantity,
                    attached_by,
                    note
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    data.warehouse_item_id,
                    data.quantity,
                    current_user["id"],
                    data.note
                )
            )

            link_id = cursor.lastrowid

            item_title = f"{item['name']}"
            if item["model"]:
                item_title += f" {item['model']}"
            if item["identifier_value"]:
                item_title += f" ({item['identifier_type']}: {item['identifier_value']})"

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
                    "EQUIPMENT_ATTACHED",
                    None,
                    f"{item_title}, quantity={data.quantity}"
                )
            )

            connection.commit()

            return {
                "message": "Оборудование привязано к заявке",
                "link_id": link_id,
                "request_id": request_id,
                "warehouse_item_id": data.warehouse_item_id
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/requests/{request_id}/equipment")
def get_request_equipment(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить оборудование, привязанное к заявке.
    Доступ: все авторизованные пользователи.
    """
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id
                FROM requests
                WHERE id = %s AND is_deleted = 0
                """,
                (request_id,)
            )
            request = cursor.fetchone()

            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")

            sql = """
            SELECT 
                re.id AS link_id,
                re.request_id,
                re.warehouse_item_id,
                re.quantity,
                re.attached_at,
                re.note,

                wi.category,
                wi.name,
                wi.manufacturer,
                wi.model,
                wi.identifier_type,
                wi.identifier_value,
                wi.serial_number,
                wi.is_serialized,
                wi.status,

                u.name AS attached_by_name
            FROM request_equipment re
            LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
            LEFT JOIN users u ON re.attached_by = u.id
            WHERE re.request_id = %s
            ORDER BY re.attached_at DESC
            """

            cursor.execute(sql, (request_id,))
            return cursor.fetchall()

    finally:
        connection.close()

@router.delete("/requests/{request_id}/equipment/{link_id}")
def detach_equipment_from_request(
    request_id: int,
    link_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Отвязать оборудование от заявки и вернуть на склад.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    re.id,
                    re.request_id,
                    re.warehouse_item_id,
                    re.quantity,

                    wi.name,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.is_serialized,
                    wi.quantity AS current_quantity,
                    wi.status
                FROM request_equipment re
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                WHERE re.id = %s
                AND re.request_id = %s
                """,
                (link_id, request_id)
            )
            link = cursor.fetchone()

            if not link:
                raise HTTPException(status_code=404, detail="Привязка оборудования не найдена")

            is_serialized = bool(link["is_serialized"])

            if is_serialized:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET status = 'IN_STOCK',
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (link["warehouse_item_id"],)
                )
            else:
                new_quantity = int(link["current_quantity"]) + int(link["quantity"])

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_quantity, link["warehouse_item_id"])
                )

            cursor.execute(
                """
                DELETE FROM request_equipment
                WHERE id = %s
                """,
                (link_id,)
            )

            item_title = f"{link['name']}"
            if link["model"]:
                item_title += f" {link['model']}"
            if link["identifier_value"]:
                item_title += f" ({link['identifier_type']}: {link['identifier_value']})"

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
                    "EQUIPMENT_DETACHED",
                    f"{item_title}, quantity={link['quantity']}",
                    None
                )
            )

            connection.commit()

            return {
                "message": "Оборудование отвязано от заявки и возвращено на склад",
                "link_id": link_id,
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