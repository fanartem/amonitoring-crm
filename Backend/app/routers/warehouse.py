from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from io import StringIO
import csv
import json

from app.database import get_connection
from app.security import get_current_user
from app.schemas import (
    WarehouseItemCreate,
    WarehouseItemUpdate,
    WarehouseItemTransfer,
    RequestEquipmentAttach,
)

router = APIRouter(prefix="/warehouse", tags=["Warehouse"])

WAREHOUSE_MANAGE_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"]
WAREHOUSE_READ_ROLES = ["ADMIN", "ROP", "WAREHOUSE_MANAGER", "MANAGER", "SENIOR_TECHNICIAN", "TECHNICIAN"]

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
    city_id = data.get("city_id")

    if category is not None and category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Некорректная категория оборудования")

    if identifier_type is not None and identifier_type not in ALLOWED_IDENTIFIER_TYPES:
        raise HTTPException(status_code=400, detail="Некорректный тип идентификатора")

    if quantity is not None and quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")
    
    if city_id is None:
        raise HTTPException(status_code=400, detail="Необходимо выбрать город склада")

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
    
def normalize_group_key(value):
    return " ".join(str(value or "").strip().lower().split())

def empty_status_counts():
    return {
        "IN_STOCK": 0,
        "RESERVED": 0,
        "INSTALLED": 0,
        "WRITTEN_OFF": 0,
    }

def add_status_count(counts: dict, status: str, quantity: int):
    status_key = status if status in ALLOWED_STATUSES else "IN_STOCK"
    counts[status_key] = int(counts.get(status_key, 0)) + int(quantity or 0)

def get_warehouse_item_quantity(row):
    if bool(row.get("is_serialized")):
        return 1

    return int(row.get("quantity") or 0)

def get_item_group_name(row):
    """
    Группируем по name, потому что заведующий складом при импорте
    чаще всего заполняет только 'Наименование'.
    """
    return str(row.get("name") or "Без наименования").strip() or "Без наименования"

def get_city_by_id(cursor, city_id: int):
    cursor.execute(
        """
        SELECT id, name
        FROM cities
        WHERE id = %s AND is_active = 1
        """,
        (city_id,)
    )
    return cursor.fetchone()


def require_city(cursor, city_id: int):
    city = get_city_by_id(cursor, city_id)

    if not city:
        raise HTTPException(status_code=400, detail="Город не найден или отключён")

    return city


def add_warehouse_movement(
    cursor,
    warehouse_item_id: int,
    action: str,
    current_user: dict,
    from_city_id: int | None = None,
    to_city_id: int | None = None,
    quantity: int | None = None,
    reason: str | None = None,
):
    cursor.execute(
        """
        INSERT INTO warehouse_item_movements (
            warehouse_item_id,
            action,
            from_city_id,
            to_city_id,
            quantity,
            reason,
            created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            warehouse_item_id,
            action,
            from_city_id,
            to_city_id,
            quantity,
            reason,
            current_user["id"],
        )
    )


def normalize_consumable_key(row: dict):
    return (
        str(row.get("category") or "").strip(),
        normalize_group_key(row.get("name")),
        normalize_group_key(row.get("manufacturer")),
        normalize_group_key(row.get("model")),
    )


def find_consumable_in_city(cursor, item: dict, city_id: int):
    cursor.execute(
        """
        SELECT *
        FROM warehouse_items
        WHERE is_deleted = 0
          AND is_serialized = 0
          AND category = %s
          AND LOWER(TRIM(name)) = LOWER(TRIM(%s))
          AND COALESCE(LOWER(TRIM(manufacturer)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND COALESCE(LOWER(TRIM(model)), '') = COALESCE(LOWER(TRIM(%s)), '')
          AND city_id = %s
        LIMIT 1
        """,
        (
            item.get("category"),
            item.get("name"),
            item.get("manufacturer"),
            item.get("model"),
            city_id,
        )
    )

    return cursor.fetchone()

def find_serialized_by_identifier(cursor, identifier_type: str, identifier_value: str):
    cursor.execute(
        """
        SELECT *
        FROM warehouse_items
        WHERE is_deleted = 0
          AND is_serialized = 1
          AND identifier_type = %s
          AND identifier_value = %s
        LIMIT 1
        """,
        (identifier_type, identifier_value)
    )

    return cursor.fetchone()

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
    from_city_id: int = Form(...),
    to_city_id: int = Form(...),
    edited_quantities_json: str | None = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Импорт оборудования из CSV с учётом городов склада.

    Серийное оборудование:
    - новое добавляется в to_city_id;
    - если уже есть в to_city_id — пропускается;
    - если есть в from_city_id и to_city_id другой — переносится;
    - если находится не в from_city_id — ошибка.

    Расходники:
    - если from_city_id == to_city_id — приход/суммирование в этом городе;
    - если from_city_id != to_city_id — перенос количества из from_city_id в to_city_id.
    """
    require_warehouse_manage(current_user)

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Поддерживается только CSV-файл")

    edited_quantities = {}

    if edited_quantities_json:
        try:
            edited_quantities = json.loads(edited_quantities_json)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Некорректный формат edited_quantities_json"
            )

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
    transferred_count = 0
    skipped_count = 0
    consumables_updated_count = 0
    errors = []

    file_keys = set()

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            from_city = require_city(cursor, from_city_id)
            to_city = require_city(cursor, to_city_id)

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

                    raw_quantity = parse_int(row.get("quantity"), default=1)
                    quantity = int(edited_quantities.get(str(index), raw_quantity))

                    note = (row.get("note") or "").strip() or None

                    if not name:
                        raise HTTPException(status_code=400, detail="name обязателен")

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
                        "city_id": to_city_id,
                        "note": note,
                    }

                    validate_warehouse_item(item_data)

                    # -------------------------
                    # Серийное оборудование
                    # -------------------------
                    if is_serialized:
                        key = f"{identifier_type}:{identifier_value}".lower()

                        if key in file_keys:
                            skipped_count += 1
                            errors.append({
                                "row": index,
                                "error": "Дубликат внутри CSV",
                                "identifier_type": identifier_type,
                                "identifier_value": identifier_value,
                            })
                            continue

                        file_keys.add(key)

                        existing = find_serialized_by_identifier(
                            cursor,
                            identifier_type,
                            identifier_value,
                        )

                        if existing:
                            existing_city_id = int(existing["city_id"])

                            if existing_city_id == int(to_city_id):
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование уже есть в выбранном городе",
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            if existing_city_id != int(from_city_id):
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование найдено, но находится не в выбранном городе отправления",
                                    "current_city_id": existing_city_id,
                                    "from_city_id": from_city_id,
                                    "to_city_id": to_city_id,
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            if existing["status"] != "IN_STOCK":
                                skipped_count += 1
                                errors.append({
                                    "row": index,
                                    "error": "Оборудование найдено, но его нельзя перенести, так как оно не на складе",
                                    "status": existing["status"],
                                    "identifier_type": identifier_type,
                                    "identifier_value": identifier_value,
                                })
                                continue

                            cursor.execute(
                                """
                                UPDATE warehouse_items
                                SET city_id = %s,
                                    updated_at = NOW()
                                WHERE id = %s
                                """,
                                (to_city_id, existing["id"])
                            )

                            add_warehouse_movement(
                                cursor=cursor,
                                warehouse_item_id=existing["id"],
                                action="IMPORT_SERIALIZED_TRANSFERRED",
                                current_user=current_user,
                                from_city_id=from_city_id,
                                to_city_id=to_city_id,
                                quantity=1,
                                reason=f"Перенос через CSV-импорт: {file.filename}",
                            )

                            transferred_count += 1
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
                                city_id,
                                status,
                                note,
                                created_by
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                category,
                                name,
                                manufacturer,
                                model,
                                identifier_type,
                                identifier_value,
                                serial_number,
                                True,
                                1,
                                to_city_id,
                                "IN_STOCK",
                                note,
                                current_user["id"],
                            )
                        )

                        item_id = cursor.lastrowid

                        add_warehouse_movement(
                            cursor=cursor,
                            warehouse_item_id=item_id,
                            action="IMPORT_CREATED",
                            current_user=current_user,
                            from_city_id=None,
                            to_city_id=to_city_id,
                            quantity=1,
                            reason=f"Создано через CSV-импорт: {file.filename}",
                        )

                        imported_count += 1
                        continue

                    # -------------------------
                    # Расходники
                    # -------------------------
                    item_for_search = {
                        "category": category,
                        "name": name,
                        "manufacturer": manufacturer,
                        "model": model,
                    }

                    if from_city_id == to_city_id:
                        target_item = find_consumable_in_city(
                            cursor,
                            item_for_search,
                            to_city_id,
                        )

                        if target_item:
                            cursor.execute(
                                """
                                UPDATE warehouse_items
                                SET quantity = quantity + %s,
                                    updated_at = NOW()
                                WHERE id = %s
                                """,
                                (quantity, target_item["id"])
                            )

                            target_item_id = target_item["id"]
                        else:
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
                                    city_id,
                                    status,
                                    note,
                                    created_by
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                (
                                    category,
                                    name,
                                    manufacturer,
                                    model,
                                    "NONE",
                                    None,
                                    None,
                                    False,
                                    quantity,
                                    to_city_id,
                                    "IN_STOCK",
                                    note,
                                    current_user["id"],
                                )
                            )

                            target_item_id = cursor.lastrowid

                        add_warehouse_movement(
                            cursor=cursor,
                            warehouse_item_id=target_item_id,
                            action="IMPORT_CONSUMABLE_ADDED",
                            current_user=current_user,
                            from_city_id=None,
                            to_city_id=to_city_id,
                            quantity=quantity,
                            reason=f"Приход расходника через CSV-импорт: {file.filename}",
                        )

                        consumables_updated_count += 1
                        continue

                    source_item = find_consumable_in_city(
                        cursor,
                        item_for_search,
                        from_city_id,
                    )

                    if not source_item:
                        skipped_count += 1
                        errors.append({
                            "row": index,
                            "error": "Расходник не найден в городе отправления",
                            "from_city_id": from_city_id,
                            "to_city_id": to_city_id,
                            "name": name,
                        })
                        continue

                    available_quantity = int(source_item["quantity"] or 0)

                    if quantity > available_quantity:
                        skipped_count += 1
                        errors.append({
                            "row": index,
                            "error": f"Недостаточно расходника в городе отправления. Доступно: {available_quantity}",
                            "from_city_id": from_city_id,
                            "to_city_id": to_city_id,
                            "name": name,
                        })
                        continue

                    target_item = find_consumable_in_city(
                        cursor,
                        item_for_search,
                        to_city_id,
                    )

                    if target_item:
                        cursor.execute(
                            """
                            UPDATE warehouse_items
                            SET quantity = quantity + %s,
                                updated_at = NOW()
                            WHERE id = %s
                            """,
                            (quantity, target_item["id"])
                        )

                        target_item_id = target_item["id"]
                    else:
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
                                city_id,
                                status,
                                note,
                                created_by
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                category,
                                name,
                                manufacturer,
                                model,
                                "NONE",
                                None,
                                None,
                                False,
                                quantity,
                                to_city_id,
                                "IN_STOCK",
                                note,
                                current_user["id"],
                            )
                        )

                        target_item_id = cursor.lastrowid

                    cursor.execute(
                        """
                        UPDATE warehouse_items
                        SET quantity = quantity - %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (quantity, source_item["id"])
                    )

                    add_warehouse_movement(
                        cursor=cursor,
                        warehouse_item_id=source_item["id"],
                        action="IMPORT_CONSUMABLE_TRANSFERRED_OUT",
                        current_user=current_user,
                        from_city_id=from_city_id,
                        to_city_id=to_city_id,
                        quantity=quantity,
                        reason=f"Перенос расходника через CSV-импорт: {file.filename}",
                    )

                    add_warehouse_movement(
                        cursor=cursor,
                        warehouse_item_id=target_item_id,
                        action="IMPORT_CONSUMABLE_TRANSFERRED_IN",
                        current_user=current_user,
                        from_city_id=from_city_id,
                        to_city_id=to_city_id,
                        quantity=quantity,
                        reason=f"Перенос расходника через CSV-импорт: {file.filename}",
                    )

                    consumables_updated_count += 1

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
                "from_city_id": from_city_id,
                "from_city_name": from_city["name"],
                "to_city_id": to_city_id,
                "to_city_name": to_city["name"],
                "imported_count": imported_count,
                "transferred_count": transferred_count,
                "consumables_updated_count": consumables_updated_count,
                "skipped_count": skipped_count,
                "errors": errors,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/items/grouped")
def get_warehouse_items_grouped(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    city_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Иерархический список склада:
    Категория -> Наименование -> позиции.

    Для серийного оборудования quantity считается как 1 на строку.
    Для расходников quantity берется из warehouse_items.quantity.
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
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.note,
                wi.created_at,
                wi.updated_at,
                u.name AS created_by_name,

                r.id AS installed_request_id,
                r.city AS installed_city,
                r.address AS installed_address,

                c.id AS installed_client_id,
                c.type AS client_type,
                c.name AS client_name,
                c.company_name,

                rv.id AS installed_request_vehicle_id,
                v.id AS installed_vehicle_id,
                v.brand,
                v.model AS vehicle_model,
                v.plate_number,
                v.vin
                
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.created_by = u.id
            LEFT JOIN cities city ON wi.city_id = city.id

            LEFT JOIN (
                SELECT 
                    warehouse_item_id,
                    MAX(id) AS last_equipment_link_id
                FROM request_equipment
                GROUP BY warehouse_item_id
            ) latest_eq ON wi.id = latest_eq.warehouse_item_id

            LEFT JOIN request_equipment re ON latest_eq.last_equipment_link_id = re.id
            LEFT JOIN requests r ON re.request_id = r.id AND r.is_deleted = 0
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
            LEFT JOIN vehicles v ON rv.vehicle_id = v.id

            WHERE wi.is_deleted = 0
            """
            values = []

            if category:
                sql += " AND wi.category = %s"
                values.append(category)

            if status:
                sql += " AND wi.status = %s"
                values.append(status)

            if city_id:
                sql += " AND wi.city_id = %s"
                values.append(city_id)

            if search:
                sql += """
                AND (
                    wi.name LIKE %s OR
                    wi.manufacturer LIKE %s OR
                    wi.model LIKE %s OR
                    wi.identifier_value LIKE %s OR
                    wi.serial_number LIKE %s OR
                    wi.note LIKE %s
                )
                """
                like_value = f"%{search}%"
                values.extend([
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                    like_value,
                ])

            sql += """
            ORDER BY
                city.name ASC,
                wi.category ASC,
                wi.name ASC,
                wi.status ASC,
                wi.created_at DESC
            """

            cursor.execute(sql, tuple(values))
            rows = cursor.fetchall()

            categories_map = {}

            for row in rows:
                item_quantity = get_warehouse_item_quantity(row)
                category_key = row.get("category") or "OTHER"
                category_name = category_key

                if category_key not in categories_map:
                    categories_map[category_key] = {
                        "category": category_key,
                        "category_name": category_name,
                        "counts": empty_status_counts(),
                        "total_quantity": 0,
                        "total_rows": 0,
                        "groups": {},
                    }

                category_group = categories_map[category_key]

                add_status_count(
                    category_group["counts"],
                    row.get("status"),
                    item_quantity,
                )
                category_group["total_quantity"] += item_quantity
                category_group["total_rows"] += 1

                item_group_name = get_item_group_name(row)
                item_group_key = normalize_group_key(item_group_name)

                if item_group_key not in category_group["groups"]:
                    category_group["groups"][item_group_key] = {
                        "group_key": item_group_key,
                        "name": item_group_name,
                        "manufacturer": row.get("manufacturer"),
                        "model": row.get("model"),
                        "is_consumable_group": not bool(row.get("is_serialized")),
                        "counts": empty_status_counts(),
                        "total_quantity": 0,
                        "total_rows": 0,
                        "items": [],
                    }

                item_group = category_group["groups"][item_group_key]

                add_status_count(
                    item_group["counts"],
                    row.get("status"),
                    item_quantity,
                )
                item_group["total_quantity"] += item_quantity
                item_group["total_rows"] += 1

                # Если в одной группе есть и серийные, и несерийные позиции,
                # группа считается смешанной, но расходники всё равно видны по quantity.
                if bool(row.get("is_serialized")):
                    item_group["is_consumable_group"] = False

                item_group["items"].append(row)

            result = []

            for category_data in categories_map.values():
                groups = list(category_data["groups"].values())

                groups.sort(
                    key=lambda group: (
                        group["name"].lower(),
                        group["group_key"],
                    )
                )

                for group in groups:
                    group["items"].sort(
                        key=lambda item: (
                            item.get("status") or "",
                            item.get("identifier_value") or "",
                            item.get("serial_number") or "",
                            -int(item.get("id") or 0),
                        )
                    )

                category_data["groups"] = groups

                result.append(category_data)

            result.sort(key=lambda item: item["category"])

            return result

    finally:
        connection.close()

@router.get("/items")
def get_warehouse_items(
    category: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    city_id: int | None = Query(None),
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
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.note,
                wi.created_at,
                wi.updated_at,
                u.name AS created_by_name,

                -- кому и куда установлено
                r.id AS installed_request_id,
                r.city AS installed_city,
                r.address AS installed_address,

                c.id AS installed_client_id,
                c.type AS client_type,
                c.name AS client_name,
                c.company_name,

                rv.id AS installed_request_vehicle_id,
                v.id AS installed_vehicle_id,
                v.brand,
                v.model AS vehicle_model,
                v.plate_number,
                v.vin
                
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.created_by = u.id
            LEFT JOIN cities city ON wi.city_id = city.id

            LEFT JOIN (
                SELECT 
                    warehouse_item_id,
                    MAX(id) AS last_equipment_link_id
                FROM request_equipment
                GROUP BY warehouse_item_id
            ) latest_eq ON wi.id = latest_eq.warehouse_item_id

            LEFT JOIN request_equipment re ON latest_eq.last_equipment_link_id = re.id
            LEFT JOIN requests r ON re.request_id = r.id AND r.is_deleted = 0
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
            LEFT JOIN vehicles v ON rv.vehicle_id = v.id

            WHERE wi.is_deleted = 0
            """
            values = []

            if category:
                sql += " AND wi.category = %s"
                values.append(category)

            if status:
                sql += " AND wi.status = %s"
                values.append(status)

            if city_id:
                sql += " AND wi.city_id = %s"
                values.append(city_id)

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

            sql += " ORDER BY city.name ASC, wi.created_at DESC"

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
            require_city(cursor, data.city_id)

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
                city_id,
                status,
                note,
                created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                data.city_id,
                "IN_STOCK",
                data.note,
                current_user["id"],
            ))

            item_id = cursor.lastrowid

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CREATED",
                current_user=current_user,
                from_city_id=None,
                to_city_id=data.city_id,
                quantity=data.quantity,
                reason="Создано вручную"
            )

            connection.commit()

            return {
                "message": "Оборудование добавлено на склад",
                "item_id": item_id
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
            
            if "city_id" in update_data:
                if not bool(item["is_serialized"]):
                    raise HTTPException(
                        status_code=400,
                        detail="Для расходников используйте перенос количества между городами"
                    )

                require_city(cursor, update_data["city_id"])

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
                "city_id",
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

            if "city_id" in update_data and int(update_data["city_id"]) != int(item["city_id"]):
                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="CITY_CHANGED",
                    current_user=current_user,
                    from_city_id=item["city_id"],
                    to_city_id=update_data["city_id"],
                    quantity=1,
                    reason="Город изменён через редактирование оборудования"
                )

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

@router.post("/items/{item_id}/transfer")
def transfer_warehouse_item(
    item_id: int,
    data: WarehouseItemTransfer,
    current_user: dict = Depends(get_current_user)
):
    """
    Перенос оборудования между городами.
    Серийное оборудование переносится целиком.
    Расходники переносятся выбранным количеством.
    """
    require_warehouse_manage(current_user)

    if data.from_city_id == data.to_city_id:
        raise HTTPException(
            status_code=400,
            detail="Город отправления и город назначения не должны совпадать"
        )

    if data.quantity <= 0:
        raise HTTPException(
            status_code=400,
            detail="Количество для переноса должно быть больше 0"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            from_city = require_city(cursor, data.from_city_id)
            to_city = require_city(cursor, data.to_city_id)

            cursor.execute(
                """
                SELECT *
                FROM warehouse_items
                WHERE id = %s
                  AND is_deleted = 0
                """,
                (item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["status"] != "IN_STOCK":
                raise HTTPException(
                    status_code=400,
                    detail="Переносить можно только оборудование со статусом 'На складе'"
                )

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if int(item["city_id"]) != int(data.from_city_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Оборудование находится не в выбранном городе отправления"
                    )

                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET city_id = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.to_city_id, item_id)
                )

                add_warehouse_movement(
                    cursor=cursor,
                    warehouse_item_id=item_id,
                    action="CITY_TRANSFERRED",
                    current_user=current_user,
                    from_city_id=data.from_city_id,
                    to_city_id=data.to_city_id,
                    quantity=1,
                    reason=data.reason,
                )

                connection.commit()

                return {
                    "message": "Оборудование перенесено",
                    "item_id": item_id,
                    "from_city": from_city["name"],
                    "to_city": to_city["name"],
                    "quantity": 1,
                }

            available_quantity = int(item["quantity"] or 0)

            if int(item["city_id"]) != int(data.from_city_id):
                raise HTTPException(
                    status_code=400,
                    detail="Расходник находится не в выбранном городе отправления"
                )

            if data.quantity > available_quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно количества для переноса. Доступно: {available_quantity}"
                )

            target_item = find_consumable_in_city(cursor, item, data.to_city_id)

            if target_item:
                cursor.execute(
                    """
                    UPDATE warehouse_items
                    SET quantity = quantity + %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data.quantity, target_item["id"])
                )

                target_item_id = target_item["id"]
            else:
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
                        city_id,
                        status,
                        note,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item["category"],
                        item["name"],
                        item["manufacturer"],
                        item["model"],
                        "NONE",
                        None,
                        None,
                        False,
                        data.quantity,
                        data.to_city_id,
                        "IN_STOCK",
                        item["note"],
                        current_user["id"],
                    )
                )

                target_item_id = cursor.lastrowid

            new_source_quantity = available_quantity - data.quantity

            cursor.execute(
                """
                UPDATE warehouse_items
                SET quantity = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (new_source_quantity, item_id)
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=item_id,
                action="CONSUMABLE_TRANSFERRED_OUT",
                current_user=current_user,
                from_city_id=data.from_city_id,
                to_city_id=data.to_city_id,
                quantity=data.quantity,
                reason=data.reason,
            )

            add_warehouse_movement(
                cursor=cursor,
                warehouse_item_id=target_item_id,
                action="CONSUMABLE_TRANSFERRED_IN",
                current_user=current_user,
                from_city_id=data.from_city_id,
                to_city_id=data.to_city_id,
                quantity=data.quantity,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Расходник перенесён",
                "source_item_id": item_id,
                "target_item_id": target_item_id,
                "from_city": from_city["name"],
                "to_city": to_city["name"],
                "quantity": data.quantity,
                "source_quantity_left": new_source_quantity,
            }

    except HTTPException:
        connection.rollback()
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
                wi.city_id,
                city.name AS city_name,
                wi.status,
                wi.note,
                wi.deleted_at,
                wi.deleted_by,
                u.name AS deleted_by_name
            FROM warehouse_items wi
            LEFT JOIN users u ON wi.deleted_by = u.id
            LEFT JOIN cities city ON wi.city_id = city.id
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

@router.get("/requests/{request_id}/equipment")
def get_request_equipment(
    request_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить всё оборудование, привязанное к заявке.
    Доступ: все авторизованные пользователи.
    """
    require_warehouse_read(current_user)

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

            cursor.execute(
                """
                SELECT 
                    re.id AS link_id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    wi.city_id,
                    city.name AS city_name,
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

                    rv.vehicle_id,
                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number,
                    v.vin,

                    u.name AS attached_by_name
                FROM request_equipment re
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                LEFT JOIN users u ON re.attached_by = u.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE re.request_id = %s
                ORDER BY re.attached_at DESC
                """,
                (request_id,)
            )

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
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,

                    wi.name,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.is_serialized,
                    wi.quantity AS current_quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,

                    v.brand,
                    v.model AS vehicle_model,
                    v.plate_number
                FROM request_equipment re
                LEFT JOIN warehouse_items wi ON re.warehouse_item_id = wi.id
                LEFT JOIN request_vehicles rv ON re.request_vehicle_id = rv.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE re.id = %s
                  AND re.request_id = %s
                """,
                (link_id, request_id)
            )
            link = cursor.fetchone()

            if not link:
                raise HTTPException(
                    status_code=404,
                    detail="Привязка оборудования не найдена"
                )

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

            vehicle_title = f"{link['brand'] or ''} {link['vehicle_model'] or ''}".strip()
            if link["plate_number"]:
                vehicle_title += f" ({link['plate_number']})"

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
                    f"{item_title}, quantity={link['quantity']}, vehicle={vehicle_title}",
                    None
                )
            )

            connection.commit()

            return {
                "message": "Оборудование отвязано от заявки и возвращено на склад",
                "link_id": link_id,
                "request_id": request_id,
                "request_vehicle_id": link["request_vehicle_id"]
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.post("/request-vehicles/{request_vehicle_id}/equipment")
def attach_equipment_to_request_vehicle(
    request_vehicle_id: int,
    data: RequestEquipmentAttach,
    current_user: dict = Depends(get_current_user)
):
    """
    Привязать оборудование к конкретному авто внутри заявки.
    Доступ: ADMIN, WAREHOUSE_MANAGER.
    """
    require_warehouse_manage(current_user)

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше 0")

    if data.request_vehicle_id != request_vehicle_id:
        raise HTTPException(
            status_code=400,
            detail="request_vehicle_id в URL и body не совпадают"
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            # Проверяем авто внутри заявки
            cursor.execute(
                """
                SELECT
                    rv.id AS request_vehicle_id,
                    rv.request_id,
                    rv.vehicle_id,

                    r.status,
                    r.is_deleted,

                    v.brand,
                    v.model,
                    v.plate_number
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                LEFT JOIN vehicles v ON rv.vehicle_id = v.id
                WHERE rv.id = %s
                """,
                (request_vehicle_id,)
            )
            request_vehicle = cursor.fetchone()

            if not request_vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Автомобиль в заявке не найден"
                )

            if request_vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование к удалённой заявке"
                )

            request_id = request_vehicle["request_id"]

            # Проверяем оборудование
            cursor.execute(
                """
                SELECT 
                    wi.id,
                    wi.category,
                    wi.name,
                    wi.manufacturer,
                    wi.model,
                    wi.identifier_type,
                    wi.identifier_value,
                    wi.is_serialized,
                    wi.quantity,
                    wi.city_id,
                    city.name AS city_name,
                    wi.status,
                    wi.is_deleted
                FROM warehouse_items wi
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE wi.id = %s
                """,
                (data.warehouse_item_id,)
            )
            item = cursor.fetchone()

            if not item:
                raise HTTPException(status_code=404, detail="Оборудование не найдено")

            if item["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя привязать оборудование из корзины"
                )

            if item["status"] != "IN_STOCK":
                raise HTTPException(
                    status_code=400,
                    detail="Оборудование недоступно на складе"
                )

            is_serialized = bool(item["is_serialized"])

            if is_serialized:
                if data.quantity != 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Для серийного оборудования количество должно быть 1"
                    )

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

            cursor.execute(
                """
                INSERT INTO request_equipment (
                    request_id,
                    request_vehicle_id,
                    warehouse_item_id,
                    quantity,
                    attached_by,
                    note
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    request_vehicle_id,
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

            vehicle_title = f"{request_vehicle['brand'] or ''} {request_vehicle['model'] or ''}".strip()
            if request_vehicle["plate_number"]:
                vehicle_title += f" ({request_vehicle['plate_number']})"

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
                    f"{item_title}, quantity={data.quantity}, vehicle={vehicle_title}"
                )
            )

            connection.commit()

            return {
                "message": "Оборудование привязано к автомобилю в заявке",
                "link_id": link_id,
                "request_id": request_id,
                "request_vehicle_id": request_vehicle_id,
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

@router.get("/request-vehicles/{request_vehicle_id}/equipment")
def get_request_vehicle_equipment(
    request_vehicle_id: int,
    current_user: dict = Depends(get_current_user)
):
    """
    Получить оборудование конкретного автомобиля внутри заявки.
    Доступ: все авторизованные пользователи.
    """
    require_warehouse_read(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    rv.id,
                    rv.request_id,
                    r.is_deleted
                FROM request_vehicles rv
                INNER JOIN requests r ON rv.request_id = r.id
                WHERE rv.id = %s
                """,
                (request_vehicle_id,)
            )
            request_vehicle = cursor.fetchone()

            if not request_vehicle:
                raise HTTPException(
                    status_code=404,
                    detail="Автомобиль в заявке не найден"
                )

            if request_vehicle["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Заявка удалена"
                )

            cursor.execute(
                """
                SELECT 
                    re.id AS link_id,
                    re.request_id,
                    re.request_vehicle_id,
                    re.warehouse_item_id,
                    re.quantity,
                    wi.city_id,
                    city.name AS city_name,
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
                LEFT JOIN cities city ON wi.city_id = city.id
                WHERE re.request_vehicle_id = %s
                ORDER BY re.attached_at DESC
                """,
                (request_vehicle_id,)
            )

            return cursor.fetchall()

    finally:
        connection.close()

