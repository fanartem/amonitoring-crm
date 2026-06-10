from fastapi import APIRouter, HTTPException, Depends
from app.database import get_connection
from app.schemas import (
    ClientCreate,
    ClientUpdate,
    ClientStatusUpdate,
    ClientResponsibleUpdate,
)
from app.security import get_current_user
from app.permissions import (
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    can_open_client_details,
    can_edit_client,
    can_change_client_status,
    can_reassign_clients,
    can_create_request_for_client,
    is_valid_client_status,
)

router = APIRouter(prefix="/clients", tags=["Clients"])

def normalize_text(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())

CRM_GROUP_NAME = "Обычные клиенты CRM"

TECHNICAL_ROOT_PARENT_NAMES = {
    'тоо "автопарк-слежение"',
    'тоо «автопарк-слежение»',
    'автопарк-слежение',
    'автопарк слежение',
}

ALLOWED_CLIENT_CREATOR_ROLES = [ADMIN, ROP, MANAGER, TECH_SUPPORT]
ALLOWED_RESPONSIBLE_ROLES = [MANAGER, ROP, ADMIN]


def normalize_optional_str(value):
    if value is None:
        return None

    value = str(value).strip()
    return value or None


def get_client_status(value: str | None) -> str:
    status = str(value or "ACTIVE").strip().upper()

    if not is_valid_client_status(status):
        raise HTTPException(status_code=400, detail="Некорректный статус клиента")

    return status


def get_default_responsible_manager_id(data: ClientCreate, current_user: dict):
    """
    При создании клиента:
    - MANAGER становится ответственным автоматически.
    - ADMIN/ROP могут передать responsible_manager_id.
    - TECH_SUPPORT клиента создать может, но ответственным автоматически не становится.
    """
    requested_responsible_id = getattr(data, "responsible_manager_id", None)

    if requested_responsible_id is not None:
        return requested_responsible_id

    if current_user.get("role") == MANAGER:
        return current_user["id"]

    return None


def ensure_responsible_user_allowed(cursor, responsible_manager_id: int | None):
    if responsible_manager_id is None:
        return

    cursor.execute(
        """
        SELECT id, role, is_approved
        FROM users
        WHERE id = %s
        """,
        (responsible_manager_id,)
    )
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Ответственный пользователь не найден")

    if user["role"] not in ALLOWED_RESPONSIBLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Ответственным за клиента можно назначить только менеджера, РОП или админа"
        )

    if not user["is_approved"]:
        raise HTTPException(
            status_code=400,
            detail="Нельзя назначить неутверждённого пользователя ответственным"
        )


def attach_client_permissions(client: dict, current_user: dict) -> dict:
    client["can_open_details"] = can_open_client_details(client, current_user)
    client["can_edit"] = can_edit_client(client, current_user)
    client["can_change_status"] = can_change_client_status(current_user)
    client["can_reassign"] = can_reassign_clients(current_user)
    client["can_create_request"] = can_create_request_for_client(client, current_user)
    return client


def attach_clients_permissions(clients: list[dict], current_user: dict) -> list[dict]:
    for client in clients:
        attach_client_permissions(client, current_user)

        for child in client.get("children") or []:
            attach_client_tree_permissions(child, current_user)

    return clients


def attach_client_tree_permissions(client: dict, current_user: dict):
    attach_client_permissions(client, current_user)

    for child in client.get("children") or []:
        attach_client_tree_permissions(child, current_user)

    return client

def is_technical_root_parent(value: str | None) -> bool:
    normalized = normalize_text(value)
    return normalized in TECHNICAL_ROOT_PARENT_NAMES


def get_source_name(client: dict) -> str:
    return (
        client.get("source_client_name")
        or client.get("company_name")
        or client.get("name")
        or f"ID {client.get('id')}"
    )


def get_parent_source_name(client: dict) -> str | None:
    parent = client.get("source_parent_client_name")
    if not parent:
        return None

    if is_technical_root_parent(parent):
        return None

    source_name = get_source_name(client)

    if normalize_text(parent) == normalize_text(source_name):
        return None

    return parent


def empty_group(group_name: str, is_import_group: bool = True) -> dict:
    return {
        "group_name": group_name,
        "parent_client": None,
        "clients_count": 0,
        "subclients_count": 0,
        "request_count": 0,
        "vehicle_count": 0,
        "is_import_group": is_import_group,
        "clients": [],
    }


def build_client_node(client: dict) -> dict:
    client["children"] = []
    client["children_count"] = 0
    client["total_vehicle_count"] = int(client.get("vehicle_count") or 0)
    client["total_request_count"] = int(client.get("request_count") or 0)
    return client


def recalc_client_totals(
    client: dict,
    visited: set[int] | None = None
) -> tuple[int, int, int]:
    if visited is None:
        visited = set()

    client_id = int(client.get("id") or 0)

    if client_id in visited:
        return 0, 0, 0

    visited.add(client_id)

    children = client.get("children") or []

    children_count = len(children)
    total_vehicle_count = int(client.get("vehicle_count") or 0)
    total_request_count = int(client.get("request_count") or 0)

    for child in children:
        child_children_count, child_vehicle_count, child_request_count = recalc_client_totals(
            child,
            visited,
        )
        children_count += child_children_count
        total_vehicle_count += child_vehicle_count
        total_request_count += child_request_count

    client["children_count"] = children_count
    client["total_vehicle_count"] = total_vehicle_count
    client["total_request_count"] = total_request_count

    return children_count, total_vehicle_count, total_request_count

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

def get_subclient_ids_recursive(cursor, root_client_id: int) -> list[int]:
    cursor.execute(
        """
        SELECT
            id,
            source_client_name,
            company_name,
            name
        FROM clients
        WHERE id = %s
        AND is_deleted = 0
        """,
        (root_client_id,)
    )
    root = cursor.fetchone()

    if not root:
        return []

    root_source_name = get_source_name(root)
    visited_names = {normalize_text(root_source_name)}
    result_ids = []

    while True:
        if not visited_names:
            break

        placeholders = ", ".join(["%s"] * len(visited_names))

        cursor.execute(
            f"""
            SELECT
                id,
                source_client_name,
                source_parent_client_name,
                company_name,
                name
            FROM clients
            WHERE is_deleted = 0
            AND LOWER(TRIM(source_parent_client_name)) IN ({placeholders})
            """,
            tuple(visited_names)
        )

        children = cursor.fetchall()
        new_names = set()

        for child in children:
            child_id = int(child["id"])

            if child_id == int(root_client_id):
                continue

            if child_id not in result_ids:
                result_ids.append(child_id)

                child_source_name = get_source_name(child)
                normalized_child_name = normalize_text(child_source_name)

                if normalized_child_name and normalized_child_name not in visited_names:
                    new_names.add(normalized_child_name)

        if not new_names:
            break

        visited_names.update(new_names)

    return result_ids

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
                c.status,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.status_changed_at,
                c.status_changed_by,
                c.responsible_changed_at,
                c.responsible_changed_by,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by,

                creator.name AS created_by_name,
                responsible.name AS responsible_manager_name,
                status_user.name AS status_changed_by_name,
                responsible_user.name AS responsible_changed_by_name,

                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN users creator ON c.created_by = creator.id
            LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
            LEFT JOIN users status_user ON c.status_changed_by = status_user.id
            LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id
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
                c.status,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.status_changed_at,
                c.status_changed_by,
                c.responsible_changed_at,
                c.responsible_changed_by,
                c.is_deleted,
                c.deleted_at,
                c.deleted_by,
                creator.name,
                responsible.name,
                status_user.name,
                responsible_user.name
            ORDER BY c.created_at DESC
            """
            cursor.execute(sql)
            clients = cursor.fetchall()

            for client in clients:
                attach_client_permissions(client, current_user)

            return clients
    finally:
        connection.close()

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    # Только Админ и Менеджер могут создавать базу клиентов
    if current_user["role"] not in ALLOWED_CLIENT_CREATOR_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания клиента"
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

            client_status = get_client_status(getattr(data, "status", None))

            # Обычные роли при создании не должны создавать сразу BLOCKED/DEBTOR.
            # Статус меняется отдельным endpoint'ом бухгалтером/РОП/админом.
            if client_status != "ACTIVE" and not can_change_client_status(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для создания клиента с этим статусом"
                )

            responsible_manager_id = get_default_responsible_manager_id(data, current_user)
            ensure_responsible_user_allowed(cursor, responsible_manager_id)

            sql = """
                INSERT INTO clients (
                    type,
                    name,
                    company_name,
                    phone,
                    email,
                    status,
                    source_system,
                    source_client_name,
                    source_parent_client_name,
                    source_inn,
                    created_by,
                    responsible_manager_id,
                    responsible_changed_at,
                    responsible_changed_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            """

            cursor.execute(
                sql,
                (
                    (
                        data.type,
                        data.name,
                        data.company_name,
                        data.phone,
                        data.email,
                        client_status,
                        getattr(data, "source_system", None),
                        getattr(data, "source_client_name", None),
                        getattr(data, "source_parent_client_name", None),
                        getattr(data, "source_inn", None),
                        current_user["id"],
                        responsible_manager_id,
                        current_user["id"] if responsible_manager_id else None,
                    )
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
    if current_user["role"] not in ["ADMIN", "ROP"]:
        raise HTTPException(status_code=403, detail="Только Админ и РОП могут просматривать корзину клиентов")

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
                c.status,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.deleted_at,
                c.deleted_by,

                u.name AS deleted_by_name,
                creator.name AS created_by_name,
                responsible.name AS responsible_manager_name,

                COUNT(r.id) AS request_count
            FROM clients c
            LEFT JOIN users u ON c.deleted_by = u.id
            LEFT JOIN users creator ON c.created_by = creator.id
            LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
            LEFT JOIN requests r ON c.id = r.client_id
            WHERE c.is_deleted = 1
            GROUP BY 
                c.id,
                c.type,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.status,
                c.source_system,
                c.source_client_name,
                c.source_parent_client_name,
                c.source_inn,
                c.created_at,
                c.created_by,
                c.responsible_manager_id,
                c.deleted_at,
                c.deleted_by,
                u.name,
                creator.name,
                responsible.name
            ORDER BY c.deleted_at DESC
            """
            cursor.execute(sql)
            return cursor.fetchall()
    finally:
        connection.close()

@router.get("/grouped")
def get_clients_grouped(current_user: dict = Depends(get_current_user)):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 
                    c.id,
                    c.type,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.status,
                    c.source_system,
                    c.source_client_name,
                    c.source_parent_client_name,
                    c.source_inn,
                    c.created_at,
                    c.created_by,
                    c.responsible_manager_id,
                    c.status_changed_at,
                    c.status_changed_by,
                    c.responsible_changed_at,
                    c.responsible_changed_by,
                    c.is_deleted,
                    c.deleted_at,
                    c.deleted_by,

                    creator.name AS created_by_name,
                    responsible.name AS responsible_manager_name,
                    status_user.name AS status_changed_by_name,
                    responsible_user.name AS responsible_changed_by_name,

                    COUNT(DISTINCT r.id) AS request_count,
                    COUNT(DISTINCT v.id) AS vehicle_count

                FROM clients c

                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users status_user ON c.status_changed_by = status_user.id
                LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id

                LEFT JOIN requests r 
                    ON c.id = r.client_id 
                    AND r.is_deleted = 0

                LEFT JOIN vehicles v
                    ON c.id = v.client_id
                    AND v.is_deleted = 0

                WHERE c.is_deleted = 0

                GROUP BY 
                    c.id,
                    c.type,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.source_system,
                    c.source_client_name,
                    c.source_parent_client_name,
                    c.source_inn,
                    c.created_at,
                    c.is_deleted,
                    c.deleted_at,
                    c.deleted_by,
                    c.status,
                    c.created_by,
                    c.responsible_manager_id,
                    c.status_changed_at,
                    c.status_changed_by,
                    c.responsible_changed_at,
                    c.responsible_changed_by,
                    creator.name,
                    responsible.name,
                    status_user.name,
                    responsible_user.name

                ORDER BY 
                    c.source_parent_client_name ASC,
                    c.company_name ASC,
                    c.name ASC
                """
            )

            rows = cursor.fetchall()

            regular_clients = []
            hierarchy_clients = []

            for row in rows:
                # Клиенты с source_client_name/source_parent_client_name участвуют в дереве.
                # Это и импорт GlonassSoft, и новые CRM-подклиенты.
                if row.get("source_client_name") or row.get("source_parent_client_name"):
                    hierarchy_clients.append(build_client_node(row))
                else:
                    regular_clients.append(build_client_node(row))

            nodes_by_source_name = {}

            for client in hierarchy_clients:
                source_name = get_source_name(client)
                nodes_by_source_name[normalize_text(source_name)] = client

            root_clients = []
            external_groups = {}

            for client in hierarchy_clients:
                parent_name = get_parent_source_name(client)

                if not parent_name:
                    root_clients.append(client)
                    continue

                parent_node = nodes_by_source_name.get(normalize_text(parent_name))

                if parent_node:
                    parent_node["children"].append(client)
                else:
                    if parent_name not in external_groups:
                        external_groups[parent_name] = empty_group(
                            group_name=parent_name,
                            is_import_group=True,
                        )

                    external_groups[parent_name]["clients"].append(client)

            groups = []

            # Root-клиенты иерархии как отдельные верхнеуровневые группы
            for client in root_clients:
                recalc_client_totals(client)

                group_name = get_source_name(client)

                group = empty_group(
                    group_name=group_name,
                    is_import_group=client.get("source_system") == "GLONASS_SOFT",
                )

                group["parent_client"] = client
                group["clients"] = client.get("children") or []
                group["clients_count"] = 1 + int(client.get("children_count") or 0)
                group["subclients_count"] = int(client.get("children_count") or 0)
                group["request_count"] = int(client.get("total_request_count") or 0)
                group["vehicle_count"] = int(client.get("total_vehicle_count") or 0)

                groups.append(group)

            # Внешние группы, где parent указан как имя, но не найден как клиент в clients
            for group in external_groups.values():
                total_clients = 0
                total_requests = 0
                total_vehicles = 0

                for client in group["clients"]:
                    recalc_client_totals(client)
                    total_clients += 1 + int(client.get("children_count") or 0)
                    total_requests += int(client.get("total_request_count") or 0)
                    total_vehicles += int(client.get("total_vehicle_count") or 0)

                group["clients_count"] = total_clients
                group["subclients_count"] = total_clients
                group["request_count"] = total_requests
                group["vehicle_count"] = total_vehicles

                groups.append(group)

            # Обычные клиенты CRM отдельной группой
            if regular_clients:
                regular_group = empty_group(
                    group_name=CRM_GROUP_NAME,
                    is_import_group=False,
                )

                regular_group["clients"] = regular_clients
                regular_group["clients_count"] = len(regular_clients)
                regular_group["subclients_count"] = len(regular_clients)
                regular_group["request_count"] = sum(
                    int(client.get("request_count") or 0)
                    for client in regular_clients
                )
                regular_group["vehicle_count"] = sum(
                    int(client.get("vehicle_count") or 0)
                    for client in regular_clients
                )

                groups.append(regular_group)

            groups.sort(
                key=lambda group: (
                    group["group_name"] == CRM_GROUP_NAME,
                    group["group_name"].lower(),
                )
            )

            for group in groups:
                if group.get("parent_client"):
                    attach_client_tree_permissions(group["parent_client"], current_user)

                for client in group.get("clients") or []:
                    attach_client_tree_permissions(client, current_user)

            return groups

    finally:
        connection.close()

@router.patch("/{client_id}")
def update_client(
    client_id: int,
    data: ClientUpdate,
    current_user: dict = Depends(get_current_user)
):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
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
            
            if not can_edit_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этого клиента"
                )

            update_data = data.dict(exclude_unset=True)

            for forbidden_field in ["status", "responsible_manager_id"]:
                if forbidden_field in update_data:
                    update_data.pop(forbidden_field, None)

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

            allowed_fields = [
                "type",
                "name",
                "company_name",
                "phone",
                "email",
                "source_system",
                "source_client_name",
                "source_parent_client_name",
                "source_inn",
            ]

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

@router.patch("/{client_id}/status")
def update_client_status(
    client_id: int,
    data: ClientStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_change_client_status(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для изменения статуса клиента"
        )

    new_status = get_client_status(data.status)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, is_deleted
                FROM clients
                WHERE id = %s
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            if client["is_deleted"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять статус клиента из корзины"
                )

            if client["status"] == new_status:
                return {
                    "message": "Статус клиента не изменился",
                    "client_id": client_id,
                    "status": new_status,
                }

            cursor.execute(
                """
                UPDATE clients
                SET status = %s,
                    status_changed_at = NOW(),
                    status_changed_by = %s
                WHERE id = %s
                """,
                (
                    new_status,
                    current_user["id"],
                    client_id,
                )
            )

            connection.commit()

            return {
                "message": "Статус клиента обновлён",
                "client_id": client_id,
                "old_status": client["status"],
                "new_status": new_status,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/{client_id}/responsible")
def update_client_responsible(
    client_id: int,
    data: ClientResponsibleUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not can_reassign_clients(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для переназначения клиента"
        )

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
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять ответственного у клиента из корзины"
                )

            ensure_responsible_user_allowed(cursor, data.responsible_manager_id)

            target_ids = [client_id]

            if data.apply_to_subclients:
                target_ids.extend(get_subclient_ids_recursive(cursor, client_id))

            placeholders = ", ".join(["%s"] * len(target_ids))

            cursor.execute(
                f"""
                UPDATE clients
                SET responsible_manager_id = %s,
                    responsible_changed_at = NOW(),
                    responsible_changed_by = %s
                WHERE id IN ({placeholders})
                """,
                tuple([data.responsible_manager_id, current_user["id"]] + target_ids)
            )

            connection.commit()

            return {
                "message": "Ответственный менеджер обновлён",
                "client_id": client_id,
                "responsible_manager_id": data.responsible_manager_id,
                "updated_clients_count": len(target_ids),
                "updated_client_ids": target_ids,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.delete("/{client_id}")
def delete_client(client_id: int, current_user: dict = Depends(get_current_user)):
    """Soft delete клиента. Только ADMIN."""
    if current_user["role"] not in [ADMIN, ROP]:
        raise HTTPException(status_code=403, detail="Только Админ или РОП может удалять клиентов")

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
    """Восстановление клиента из корзины. Только ADMIN или ROP."""
    if current_user["role"] not in [ADMIN, ROP]:
        raise HTTPException(status_code=403, detail="Только Админ или РОП может восстанавливать клиентов")

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
                SELECT
                    id,
                    created_by,
                    responsible_manager_id,
                    is_deleted
                FROM clients
                WHERE id = %s
                AND is_deleted = 0
                """,
                (client_id,)
            )
            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")
            
            if not can_open_client_details(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра заявок этого клиента"
                )

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
                    r.total_price,
                    r.created_by,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role
                FROM requests r
                LEFT JOIN users creator ON r.created_by = creator.id
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