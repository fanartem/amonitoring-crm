from fastapi import APIRouter, HTTPException, Depends, Query
from app.database import get_connection
from app.schemas import (
    ClientCreate,
    ClientUpdate,
    ClientStatusUpdate,
    ClientResponsibleUpdate,
    ClientPaymentTypeUpdate,
)
from app.security import get_current_user
from app.permissions import (
    ADMIN,
    ROP,
    MANAGER,
    TECH_SUPPORT,
    ACCOUNTANT,
    WAREHOUSE_MANAGER,
    has_any_permission,
    get_data_scope,
    can_edit_client,
    can_change_client_status,
    can_reassign_clients,
    can_create_request_for_client,
    is_client_owned_by_user,
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

CLIENT_MONITORING_PASSWORD_VIEW_ROLES = [ADMIN, ROP, TECH_SUPPORT]

CLIENT_ACCESS_SCOPE_RESPONSIBLE_ONLY = "RESPONSIBLE_ONLY"
CLIENT_DATA_SCOPE_RESPONSIBLE_CLIENTS = "RESPONSIBLE_CLIENTS"
CLIENT_DATA_SCOPE_OWN = "OWN"

CLIENT_VIEW_PERMISSION_CODES = [
    "clients.view",
    "clients.view_all",
    "clients.view_own",
    "clients.manage",
]

CLIENT_VIEW_ALL_PERMISSION_CODES = [
    "clients.view",
    "clients.view_all",
    "clients.manage",
]

CLIENT_VIEW_OWN_PERMISSION_CODES = [
    "clients.view_own",
]

CLIENT_CREATE_PERMISSION_CODES = [
    "clients.create",
    "clients.manage",
]

CLIENT_DELETE_PERMISSION_CODES = [
    "clients.delete",
    "clients.manage",
]

CLIENT_RESTORE_PERMISSION_CODES = [
    "clients.restore",
    "clients.manage",
]

CLIENT_TRASH_VIEW_PERMISSION_CODES = [
    "trash.view",
    "clients.trash.view",
    "clients.deleted.view",
    "clients.restore",
    "clients.delete",
    "clients.manage",
]

CLIENT_PAYMENT_TYPE_MANAGE_PERMISSION_CODES = [
    "clients.payment_type.manage",
    "clients.payment.manage",
    "clients.manage",
]

CLIENT_MONITORING_PASSWORD_VIEW_PERMISSION_CODES = [
    "clients.monitoring_password.view",
    "clients.credentials.view",
    "clients.manage",
]

CLIENT_PAYMENT_PREPAYMENT = "PREPAYMENT"
CLIENT_PAYMENT_POSTPAYMENT = "POSTPAYMENT"

ALLOWED_CLIENT_PAYMENT_TYPES = [
    CLIENT_PAYMENT_PREPAYMENT,
    CLIENT_PAYMENT_POSTPAYMENT,
]

def permissions_are_loaded(current_user: dict | None) -> bool:
    return current_user is not None and isinstance(current_user.get("permissions"), list)


def has_legacy_role(current_user: dict | None, roles: list[str]) -> bool:
    if not current_user or permissions_are_loaded(current_user):
        return False

    return current_user.get("role") in roles

def can_view_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_VIEW_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP, MANAGER, TECH_SUPPORT, ACCOUNTANT, WAREHOUSE_MANAGER],
    )

def can_view_all_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_VIEW_ALL_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP, TECH_SUPPORT, ACCOUNTANT, WAREHOUSE_MANAGER],
    )

def can_create_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_CREATE_PERMISSION_CODES) or has_legacy_role(
        current_user,
        ALLOWED_CLIENT_CREATOR_ROLES,
    )

def can_delete_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_DELETE_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP],
    )

def can_restore_client(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_RESTORE_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP],
    )

def can_view_deleted_clients(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_TRASH_VIEW_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP],
    )

def can_manage_client_payment_type(current_user: dict) -> bool:
    return has_any_permission(current_user, CLIENT_PAYMENT_TYPE_MANAGE_PERMISSION_CODES) or has_legacy_role(
        current_user,
        [ADMIN, ROP],
    )

def is_responsible_only_client_scope(current_user: dict) -> bool:
    scope = current_user.get("client_access_scope") or get_data_scope(current_user)

    return scope in [
        CLIENT_ACCESS_SCOPE_RESPONSIBLE_ONLY,
        CLIENT_DATA_SCOPE_RESPONSIBLE_CLIENTS,
        CLIENT_DATA_SCOPE_OWN,
    ]

def can_view_client_monitoring_password(current_user: dict) -> bool:
    return has_any_permission(
        current_user,
        CLIENT_MONITORING_PASSWORD_VIEW_PERMISSION_CODES,
    ) or has_legacy_role(current_user, CLIENT_MONITORING_PASSWORD_VIEW_ROLES)

def can_open_client_details_for_router(client: dict, current_user: dict) -> bool:
    if can_view_all_clients(current_user):
        return True

    if has_any_permission(current_user, CLIENT_VIEW_OWN_PERMISSION_CODES) or has_legacy_role(current_user, [MANAGER]):
        return is_client_owned_by_user(client, current_user)

    return False

def ensure_can_view_clients(current_user: dict):
    if not can_view_clients(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра клиентов",
        )

def apply_client_access_scope_condition(
    conditions: list[str],
    values: list,
    current_user: dict,
    table_alias: str = "c",
):
    """
    Ограничение видимости клиентов.
    RESPONSIBLE_ONLY — пользователь видит только клиентов,
    где он указан ответственным.
    """
    if is_responsible_only_client_scope(current_user):
        conditions.append(f"{table_alias}.responsible_manager_id = %s")
        values.append(current_user["id"])

def ensure_client_visible_by_scope(client: dict, current_user: dict):
    """
    Защита прямого доступа по ID.
    Нужна, чтобы пользователь не мог открыть клиента напрямую,
    если его нет в списке.
    """
    if not is_responsible_only_client_scope(current_user):
        return

    responsible_manager_id = client.get("responsible_manager_id")

    if (
        responsible_manager_id is None
        or int(responsible_manager_id) != int(current_user["id"])
    ):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра этого клиента"
        )

def normalize_optional_str(value):
    if value is None:
        return None

    value = str(value).strip()
    return value or None

def normalize_client_bin_iin(value: str | None) -> str | None:
    if value is None:
        return None

    value = str(value).strip()
    return value or None


def is_individual_client_type(client_type: str | None) -> bool:
    return str(client_type or "").strip().upper() == "INDIVIDUAL"


def validate_client_bin_iin(client_type: str | None, bin_iin: str | None):
    """
    Для ТОО/ИП БИН обязателен.
    Для физлиц ИИН необязателен.
    """
    normalized_bin_iin = normalize_client_bin_iin(bin_iin)

    if not is_individual_client_type(client_type) and not normalized_bin_iin:
        raise HTTPException(
            status_code=400,
            detail="Для ТОО и ИП поле БИН обязательно"
        )

    return normalized_bin_iin

def get_client_status(value: str | None) -> str:
    status = str(value or "ACTIVE").strip().upper()

    if not is_valid_client_status(status):
        raise HTTPException(status_code=400, detail="Некорректный статус клиента")

    return status

def get_client_payment_type(value: str | None) -> str:
    payment_type = str(value or CLIENT_PAYMENT_PREPAYMENT).strip().upper()

    if payment_type not in ALLOWED_CLIENT_PAYMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный тип оплаты клиента"
        )

    return payment_type

def get_default_responsible_manager_id(data: ClientCreate, current_user: dict):
    """
    При создании клиента:
    - пользователь с правом переназначения может указать responsible_manager_id;
    - MANAGER или любая роль с can_be_responsible_manager становится ответственной автоматически;
    - остальные роли клиента создать могут, но ответственным автоматически не становятся.
    """
    requested_responsible_id = getattr(data, "responsible_manager_id", None)

    if requested_responsible_id is not None:
        if not can_reassign_clients(current_user):
            raise HTTPException(
                status_code=403,
                detail="Недостаточно прав для назначения ответственного за клиента",
            )

        return requested_responsible_id

    if current_user.get("can_be_responsible_manager"):
        return current_user["id"]

    return None

def ensure_responsible_user_allowed(cursor, responsible_manager_id: int | None):
    if responsible_manager_id is None:
        return

    cursor.execute(
        """
        SELECT
            u.id,
            u.role,
            u.is_approved,
            COALESCE(r.can_be_responsible_manager, 0) AS can_be_responsible_manager
        FROM users u
        LEFT JOIN roles r ON r.code = u.role
        WHERE u.id = %s
        """,
        (responsible_manager_id,)
    )
    user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Ответственный пользователь не найден")

    if user["role"] not in ALLOWED_RESPONSIBLE_ROLES and not bool(user.get("can_be_responsible_manager")):
        raise HTTPException(
            status_code=400,
            detail="Ответственным за клиента можно назначить только пользователя с правом быть ответственным менеджером"
        )

    if not user["is_approved"]:
        raise HTTPException(
            status_code=400,
            detail="Нельзя назначить неутверждённого пользователя ответственным"
        )

def attach_client_permissions(client: dict, current_user: dict) -> dict:
    client["can_open_details"] = can_open_client_details_for_router(client, current_user)
    client["can_edit"] = can_edit_client(client, current_user)
    client["can_change_status"] = can_change_client_status(current_user)
    client["can_reassign"] = can_reassign_clients(current_user)
    client["can_change_payment_type"] = can_manage_client_payment_type(current_user)
    client["can_create_request"] = can_create_request_for_client(client, current_user)
    client["can_view_monitoring_password"] = can_view_client_monitoring_password(current_user)
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

def attach_executors_to_client_requests(cursor, requests: list[dict]) -> list[dict]:
    if not requests:
        return requests

    request_ids = [r["id"] for r in requests]
    placeholders = ", ".join(["%s"] * len(request_ids))

    cursor.execute(
        f"""
        SELECT
            re.id,
            re.request_id,
            re.user_id,
            re.assigned_by,
            re.assigned_at,

            u.name AS user_name,
            u.email AS user_email,
            u.role AS user_role,
            u.city AS user_city,

            assigned_by_user.name AS assigned_by_name
        FROM request_executors re
        LEFT JOIN users u ON re.user_id = u.id
        LEFT JOIN users assigned_by_user ON re.assigned_by = assigned_by_user.id
        WHERE re.request_id IN ({placeholders})
        ORDER BY re.id ASC
        """,
        tuple(request_ids)
    )

    rows = cursor.fetchall()
    grouped = {}

    for row in rows:
        grouped.setdefault(row["request_id"], []).append(row)

    for request in requests:
        executors = grouped.get(request["id"], [])
        request["executors"] = executors
        request["executors_count"] = len(executors)
        request["executors_summary"] = ", ".join(
            executor.get("user_name") or f"ID {executor.get('user_id')}"
            for executor in executors
        )

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
    ensure_can_view_clients(current_user)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 0"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)
            sql = f"""
            SELECT 
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
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
            WHERE {where_clause}
            GROUP BY 
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
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
            cursor.execute(sql, tuple(values))
            clients = cursor.fetchall()

            for client in clients:
                attach_client_permissions(client, current_user)

            return clients
    finally:
        connection.close()

@router.post("")
def create_client(data: ClientCreate, current_user: dict = Depends(get_current_user)):
    if not can_create_client(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для создания клиента"
        )

    if (
        normalize_optional_str(getattr(data, "monitoring_password", None))
        and not can_view_client_monitoring_password(current_user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для указания пароля платформы мониторинга"
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

            client_payment_type = CLIENT_PAYMENT_PREPAYMENT

            if can_manage_client_payment_type(current_user):
                client_payment_type = get_client_payment_type(
                    getattr(data, "payment_type", None)
                )

            # Обычные роли при создании не должны создавать сразу BLOCKED/DEBTOR.
            # Статус меняется отдельным endpoint'ом бухгалтером/РОП/админом.
            if client_status != "ACTIVE" and not can_change_client_status(current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для создания клиента с этим статусом"
                )

            responsible_manager_id = get_default_responsible_manager_id(data, current_user)
            ensure_responsible_user_allowed(cursor, responsible_manager_id)

            client_bin_iin = validate_client_bin_iin(data.type, getattr(data, "bin_iin", None))

            sql = """
                INSERT INTO clients (
                    type,
                    bin_iin,
                    name,
                    company_name,
                    phone,
                    email,
                    monitoring_login,
                    monitoring_password,
                    status,
                    payment_type,
                    source_system,
                    source_client_name,
                    source_parent_client_name,
                    source_inn,
                    created_by,
                    responsible_manager_id,
                    responsible_changed_at,
                    responsible_changed_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            """

            cursor.execute(
                sql,
                (
                    (
                        data.type,
                        client_bin_iin,
                        data.name,
                        data.company_name,
                        data.phone,
                        data.email,
                        normalize_optional_str(getattr(data, "monitoring_login", None)),
                        normalize_optional_str(getattr(data, "monitoring_password", None)),
                        client_status,
                        client_payment_type,
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
    """Список удалённых клиентов."""
    if not can_view_deleted_clients(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для просмотра корзины клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 1"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)
            sql = f"""
            SELECT 
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
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
            WHERE {where_clause}
            GROUP BY 
                c.id,
                c.type,
                c.bin_iin,
                c.name,
                c.company_name,
                c.phone,
                c.email,
                c.monitoring_login,
                c.status,
                c.payment_type,
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
            cursor.execute(sql, tuple(values))
            return cursor.fetchall()
    finally:
        connection.close()

def collect_client_ids_from_group(group: dict) -> list[int]:
    ids = []

    def walk(client: dict | None):
        if not client:
            return

        client_id = client.get("id")
        if client_id:
            ids.append(int(client_id))

        for child in client.get("children") or []:
            walk(child)

    walk(group.get("parent_client"))

    for client in group.get("clients") or []:
        walk(client)

    return ids

def apply_counts_to_group(group: dict, request_counts: dict[int, int], vehicle_counts: dict[int, int]):
    def walk(client: dict | None):
        if not client:
            return

        client_id = int(client.get("id") or 0)

        client["request_count"] = int(request_counts.get(client_id, 0))
        client["vehicle_count"] = int(vehicle_counts.get(client_id, 0))
        client["total_request_count"] = int(client["request_count"])
        client["total_vehicle_count"] = int(client["vehicle_count"])

        for child in client.get("children") or []:
            walk(child)

    walk(group.get("parent_client"))

    for client in group.get("clients") or []:
        walk(client)

@router.get("/grouped")
def get_clients_grouped(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 0"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)

            # Важно: здесь НЕ джойним requests/vehicles.
            # Иначе снова будет тяжёлая загрузка всей базы.
            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.bin_iin,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.monitoring_login,
                    c.status,
                    c.payment_type,
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

                    0 AS request_count,
                    0 AS vehicle_count

                FROM clients c

                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users status_user ON c.status_changed_by = status_user.id
                LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id

                WHERE {where_clause}

                ORDER BY
                    c.source_parent_client_name ASC,
                    c.company_name ASC,
                    c.name ASC,
                    c.id ASC
                """,
                tuple(values),
            )

            rows = cursor.fetchall()

            regular_clients = []
            hierarchy_clients = []

            for row in rows:
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
                group_name = get_source_name(client)

                group = empty_group(
                    group_name=group_name,
                    is_import_group=client.get("source_system") == "GLONASS_SOFT",
                )

                group["parent_client"] = client
                group["clients"] = client.get("children") or []

                groups.append(group)

            # Внешние группы, где parent указан как имя, но не найден как клиент
            for group in external_groups.values():
                groups.append(group)

            # Обычные CRM-клиенты отдельной группой
            if regular_clients:
                regular_group = empty_group(
                    group_name=CRM_GROUP_NAME,
                    is_import_group=False,
                )

                regular_group["clients"] = regular_clients
                groups.append(regular_group)

            groups.sort(
                key=lambda group: (
                    group["group_name"] == CRM_GROUP_NAME,
                    group["group_name"].lower(),
                )
            )

            total_groups = len(groups)
            offset = (page - 1) * page_size
            paged_groups = groups[offset:offset + page_size]

            # Собираем ID клиентов только из текущей страницы групп
            paged_client_ids = []

            for group in paged_groups:
                paged_client_ids.extend(collect_client_ids_from_group(group))

            paged_client_ids = sorted(set(paged_client_ids))

            request_counts = {}
            vehicle_counts = {}

            if paged_client_ids:
                placeholders = ", ".join(["%s"] * len(paged_client_ids))

                cursor.execute(
                    f"""
                    SELECT client_id, COUNT(*) AS count
                    FROM requests
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    GROUP BY client_id
                    """,
                    tuple(paged_client_ids),
                )

                for row in cursor.fetchall():
                    request_counts[int(row["client_id"])] = int(row["count"] or 0)

                cursor.execute(
                    f"""
                    SELECT client_id, COUNT(*) AS count
                    FROM vehicles
                    WHERE is_deleted = 0
                      AND client_id IN ({placeholders})
                    GROUP BY client_id
                    """,
                    tuple(paged_client_ids),
                )

                for row in cursor.fetchall():
                    vehicle_counts[int(row["client_id"])] = int(row["count"] or 0)

            # Проставляем counts, пересчитываем totals и права только для текущей страницы
            for group in paged_groups:
                apply_counts_to_group(group, request_counts, vehicle_counts)

                if group.get("parent_client"):
                    parent_client = group["parent_client"]

                    recalc_client_totals(parent_client)

                    group["clients"] = parent_client.get("children") or []
                    group["clients_count"] = 1 + int(parent_client.get("children_count") or 0)
                    group["subclients_count"] = int(parent_client.get("children_count") or 0)
                    group["request_count"] = int(parent_client.get("total_request_count") or 0)
                    group["vehicle_count"] = int(parent_client.get("total_vehicle_count") or 0)

                    attach_client_tree_permissions(parent_client, current_user)

                    for client in group.get("clients") or []:
                        attach_client_tree_permissions(client, current_user)

                    continue

                total_clients = 0
                total_requests = 0
                total_vehicles = 0

                for client in group.get("clients") or []:
                    recalc_client_totals(client)

                    total_clients += 1 + int(client.get("children_count") or 0)
                    total_requests += int(client.get("total_request_count") or 0)
                    total_vehicles += int(client.get("total_vehicle_count") or 0)

                    attach_client_tree_permissions(client, current_user)

                group["clients_count"] = total_clients
                group["subclients_count"] = total_clients
                group["request_count"] = total_requests
                group["vehicle_count"] = total_vehicles

            return {
                "items": paged_groups,
                "total": total_groups,
                "page": page,
                "page_size": page_size,
            }

    finally:
        connection.close()

@router.get("/{client_id}/grouped-position")
def get_client_grouped_position(
    client_id: int,
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    """
    Возвращает, на какой странице /clients/grouped находится клиент,
    в какой группе он лежит и каких родителей нужно раскрыть.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = ["c.is_deleted = 0"]
            values = []

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.bin_iin,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.monitoring_login,
                    c.status,
                    c.payment_type,
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

                    0 AS request_count,
                    0 AS vehicle_count

                FROM clients c

                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users status_user ON c.status_changed_by = status_user.id
                LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id

                WHERE {where_clause}

                ORDER BY
                    c.source_parent_client_name ASC,
                    c.company_name ASC,
                    c.name ASC,
                    c.id ASC
                """,
                tuple(values),
            )

            rows = cursor.fetchall()

            regular_clients = []
            hierarchy_clients = []

            for row in rows:
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

            for client in root_clients:
                group_name = get_source_name(client)

                group = empty_group(
                    group_name=group_name,
                    is_import_group=client.get("source_system") == "GLONASS_SOFT",
                )

                group["parent_client"] = client
                group["clients"] = client.get("children") or []
                groups.append(group)

            for group in external_groups.values():
                groups.append(group)

            if regular_clients:
                regular_group = empty_group(
                    group_name=CRM_GROUP_NAME,
                    is_import_group=False,
                )

                regular_group["clients"] = regular_clients
                groups.append(regular_group)

            groups.sort(
                key=lambda group: (
                    group["group_name"] == CRM_GROUP_NAME,
                    group["group_name"].lower(),
                )
            )

            def find_in_tree(clients_list, target_id, ancestors=None):
                if ancestors is None:
                    ancestors = []

                for client in clients_list or []:
                    current_id = int(client.get("id") or 0)

                    if current_id == int(target_id):
                        return {
                            "client": client,
                            "ancestor_ids": ancestors,
                        }

                    result = find_in_tree(
                        client.get("children") or [],
                        target_id,
                        ancestors + [current_id],
                    )

                    if result:
                        return result

                return None

            for group_index, group in enumerate(groups):
                parent_client = group.get("parent_client")

                if parent_client and int(parent_client.get("id") or 0) == int(client_id):
                    return {
                        "client_id": client_id,
                        "page": (group_index // page_size) + 1,
                        "page_size": page_size,
                        "group_index": group_index,
                        "group_name": group["group_name"],
                        "is_parent_client": True,
                        "ancestor_ids": [],
                    }

                result = find_in_tree(group.get("clients") or [], client_id)

                if result:
                    return {
                        "client_id": client_id,
                        "page": (group_index // page_size) + 1,
                        "page_size": page_size,
                        "group_index": group_index,
                        "group_name": group["group_name"],
                        "is_parent_client": False,
                        "ancestor_ids": result["ancestor_ids"],
                    }

            raise HTTPException(status_code=404, detail="Клиент не найден в списке")

    finally:
        connection.close()

@router.get("/{client_id}")
def get_client_by_id(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    ensure_can_view_clients(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = [
                "c.id = %s",
                "c.is_deleted = 0",
            ]
            values = [client_id]

            apply_client_access_scope_condition(
                conditions=conditions,
                values=values,
                current_user=current_user,
                table_alias="c",
            )

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.type,
                    c.bin_iin,
                    c.name,
                    c.company_name,
                    c.phone,
                    c.email,
                    c.monitoring_login,
                    c.monitoring_password,
                    c.status,
                    c.payment_type,
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

                    (
                        SELECT COUNT(*)
                        FROM requests r
                        WHERE r.client_id = c.id
                          AND r.is_deleted = 0
                    ) AS request_count,

                    (
                        SELECT COUNT(*)
                        FROM vehicles v
                        WHERE v.client_id = c.id
                          AND v.is_deleted = 0
                    ) AS vehicle_count

                FROM clients c

                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN users responsible ON c.responsible_manager_id = responsible.id
                LEFT JOIN users status_user ON c.status_changed_by = status_user.id
                LEFT JOIN users responsible_user ON c.responsible_changed_by = responsible_user.id

                WHERE {where_clause}

                LIMIT 1
                """,
                tuple(values),
            )

            client = cursor.fetchone()

            if not client:
                raise HTTPException(status_code=404, detail="Клиент не найден")

            attach_client_permissions(client, current_user)

            if not can_open_client_details_for_router(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для просмотра этого клиента"
                )

            if not can_view_client_monitoring_password(current_user):
                client["monitoring_password"] = None

            client["children"] = []
            client["children_count"] = 0
            client["total_request_count"] = int(client.get("request_count") or 0)
            client["total_vehicle_count"] = int(client.get("vehicle_count") or 0)

            return client

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
            
            ensure_client_visible_by_scope(client, current_user)
            
            if not can_edit_client(client, current_user):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для редактирования этого клиента"
                )

            update_data = data.dict(exclude_unset=True)

            if (
                "monitoring_password" in update_data
                and normalize_optional_str(update_data.get("monitoring_password"))
                and not can_view_client_monitoring_password(current_user)
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для изменения пароля платформы мониторинга"
                )

            for forbidden_field in ["status", "responsible_manager_id"]:
                if forbidden_field in update_data:
                    update_data.pop(forbidden_field, None)

            if not update_data:
                return {"message": "Нет данных для обновления"}
            
            cursor.execute(
                """
                SELECT type, name, company_name, phone, bin_iin
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
            next_bin_iin = update_data.get("bin_iin", current_client_data.get("bin_iin"))
            next_bin_iin = validate_client_bin_iin(next_type, next_bin_iin)

            if "bin_iin" in update_data:
                update_data["bin_iin"] = next_bin_iin

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
                "bin_iin",
                "monitoring_login",
                "monitoring_password",
                "source_system",
                "source_client_name",
                "source_parent_client_name",
                "source_inn",
            ]

            updates = []
            values = []

            for optional_field in ["monitoring_login", "monitoring_password"]:
                if optional_field in update_data:
                    update_data[optional_field] = normalize_optional_str(update_data.get(optional_field))

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
            
            ensure_client_visible_by_scope(client, current_user)

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

@router.patch("/{client_id}/payment-type")
def update_client_payment_type(
    client_id: int,
    data: ClientPaymentTypeUpdate,
    current_user: dict = Depends(get_current_user)
):
    if not can_manage_client_payment_type(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для изменения типа оплаты клиента"
        )

    payment_type = get_client_payment_type(data.payment_type)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    payment_type,
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
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять тип оплаты у клиента из корзины"
                )

            ensure_client_visible_by_scope(client, current_user)

            old_payment_type = client.get("payment_type") or CLIENT_PAYMENT_PREPAYMENT

            if old_payment_type == payment_type:
                return {
                    "message": "Тип оплаты клиента не изменился",
                    "client_id": client_id,
                    "payment_type": payment_type,
                }

            cursor.execute(
                """
                UPDATE clients
                SET payment_type = %s
                WHERE id = %s
                """,
                (
                    payment_type,
                    client_id,
                )
            )

            connection.commit()

            return {
                "message": "Тип оплаты клиента обновлён",
                "client_id": client_id,
                "old_payment_type": old_payment_type,
                "payment_type": payment_type,
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
    """Soft delete клиента."""
    if not can_delete_client(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для удаления клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, существует ли клиент
            cursor.execute(
                """
                SELECT id, name, responsible_manager_id, is_deleted
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

            ensure_client_visible_by_scope(client, current_user)

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
    """Восстановление клиента из корзины."""
    if not can_restore_client(current_user):
        raise HTTPException(status_code=403, detail="Недостаточно прав для восстановления клиентов")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, responsible_manager_id, is_deleted
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

            ensure_client_visible_by_scope(client, current_user)

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
    ensure_can_view_clients(current_user)

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
            
            ensure_client_visible_by_scope(client, current_user)
            
            if not can_open_client_details_for_router(client, current_user):
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

                    client.payment_type AS client_payment_type,

                    creator.name AS created_by_name,
                    creator.role AS created_by_role
                FROM requests r
                LEFT JOIN clients client ON r.client_id = client.id
                LEFT JOIN users creator ON r.created_by = creator.id
                WHERE r.client_id = %s
                    AND r.is_deleted = 0
                ORDER BY r.created_at DESC
                """,
                (client_id,)
            )

            requests = cursor.fetchall()
            requests = attach_vehicles_to_requests(cursor, requests)
            requests = attach_executors_to_client_requests(cursor, requests)
            return requests

    finally:
        connection.close()