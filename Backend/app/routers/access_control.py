import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_connection
from app.security import get_current_user
from app.permissions import (
    is_super_admin,
    is_owner,
    is_client_user,
    require_employee_user,
    has_any_permission,
    get_user_base_access,
    attach_effective_permissions,
    add_access_audit_log,
    expand_permissions_with_dependencies,
    DATA_SCOPE_CLIENT,
    USER_KIND_CLIENT,
    CLIENT_PORTAL_ROLE,
)

from app.schemas import (
    RoleCreate,
    RoleUpdate,
    RolePermissionsUpdate,
    UserPermissionOverridesUpdate,
    UserSecurityFlagsUpdate,
    UserRoleUpdate,
)

def ensure_employee_access(current_user: dict = Depends(get_current_user)):
    """
    Управление ролями и доступами — внутренний раздел.
    Клиентская учётная запись сюда не попадает ни в каком виде.
    """
    require_employee_user(
        current_user,
        detail="Раздел доступов доступен только сотрудникам",
    )

    return current_user


router = APIRouter(
    prefix="/access",
    tags=["Access Control"],
    dependencies=[Depends(ensure_employee_access)],
)


def can_view_access_control(current_user: dict) -> bool:
    return (
        is_super_admin(current_user)
        or "roles.view" in current_user.get("permissions", [])
        or "employees.permissions.manage" in current_user.get("permissions", [])
    )


def ensure_can_view_access_control(current_user: dict):
    if not can_view_access_control(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для просмотра ролей и доступов",
        )

ROLE_CODE_RE = re.compile(r"^[A-Z0-9_]{2,50}$")
BADGE_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

ALLOWED_DATA_SCOPES = {
    "ALL",
    "CITY",
    "RESPONSIBLE_CLIENTS",
    "ASSIGNED",
    "CITY_ASSIGNED",
    "OWN",
    "NONE",
    # Область клиентского портала. Должна совпадать с enum roles.data_scope,
    # иначе интерфейс ролей показывает у CLIENT_PORTAL пустую область.
    "CLIENT",
}

SYSTEM_ROLE_PROTECTED_FIELDS = {
    "data_scope",
    "is_active",
    "can_be_request_executor",
    "can_be_responsible_manager",
}


# Permission rows that are kept active for backend compatibility, but should not
# be shown as separate checkboxes in the role/user access modal.
# They are aliases of canonical permissions and otherwise create duplicate names
# such as "Изменение статуса клиента" several times in the UI.
UI_HIDDEN_PERMISSION_CODES = {
    # Attachments: edit aliases are handled by rename permissions.
    "attachments.edit",
    "files.edit",
    "requests.attachments.edit",
    "clients.attachments.edit",

    # Clients: status aliases.
    "clients.change_status",
    "clients.status.edit",
    "clients.update_status",
    "clients.edit_status",

    # Clients: responsible manager aliases.
    "clients.reassign",
    "clients.responsible.manage",
    "clients.assign_responsible",
    "clients.edit_responsible",

    # Clients: payment type aliases.
    "clients.payment.manage",
    "clients.edit_payment",

    # Clients: monitoring credentials aliases.
    "clients.credentials.manage",
    "clients.monitoring_password.manage",
    "clients.edit_monitoring_credentials",
    "clients.monitoring_access.manage",
    "clients.access.manage",

    # Requests: executor assignment aliases.
    "requests.assign_executor",
    "requests.assign",
    "requests.assign_executors",

    # Requests: calendar aliases.
    "calendar.view",
    "calendar.view_all",

    # Requests: trash aliases.
    "requests.trash.view",
    "trash.requests.view",
    "requests.deleted.restore",
    "trash.requests.restore",

    # Requests: schedule/status aliases.
    "requests.schedule.bypass_limits",
    "requests.schedule.approve",
    "requests.status.override_transitions",

    # Requests: price aliases.
    "requests.prices.view",
    "requests.view_price",
    "requests.view_prices",
    "requests.prices.calculate",
    "requests.calculate_price",

    # Support requests: status aliases.
    "support_requests.change_status",
    "support_requests.status.change",

    # Settings/notifications aliases.
    "settings.notifications.manage",

    # Vehicles: trash/transfer aliases.
    "vehicles.deleted.view",
    "vehicles.trash.view",
    "vehicles.change_client",

    # Warehouse aliases commonly added only for backward compatibility.
    "warehouse.thresholds.manage",
    "warehouse.inventory.view",
    "warehouse.inventory.manage",
    "warehouse.history.view",
    "warehouse.equipment.history.view",
    "warehouse.employee_inventory.view",
    "warehouse.employee_inventory.manage",
}


# Права клиентского портала. Сотруднику они не дают ничего:
# can_access_portal требует user_kind = CLIENT и заполненный client_id,
# и только после этого смотрит на само право. Поэтому в чек-листах
# сотрудников эта категория не показывается — иначе администратор видит
# галочки, которые выглядят как доступ, но ни на что не влияют.
PORTAL_PERMISSION_CATEGORY = "portal"

PERMISSIONS_AUDIENCE_EMPLOYEE = "employee"
PERMISSIONS_AUDIENCE_PORTAL = "portal"
PERMISSIONS_AUDIENCE_ALL = "all"

ALLOWED_PERMISSIONS_AUDIENCES = {
    PERMISSIONS_AUDIENCE_EMPLOYEE,
    PERMISSIONS_AUDIENCE_PORTAL,
    PERMISSIONS_AUDIENCE_ALL,
}


def is_portal_permission(permission: dict) -> bool:
    return str(permission.get("category") or "").strip() == PORTAL_PERMISSION_CATEGORY


def filter_portal_permission_codes(cursor, permission_codes: set[str]) -> list[str]:
    """
    Какие из переданных кодов относятся к порталу.
    Спрашиваем базу, а не список в коде: каталог прав живёт в БД,
    и новый portal.* появится там раньше, чем здесь.
    """
    if not permission_codes:
        return []

    placeholders = ", ".join(["%s"] * len(permission_codes))

    cursor.execute(
        f"""
        SELECT code
        FROM permissions
        WHERE code IN ({placeholders})
          AND category = %s
        """,
        tuple(permission_codes) + (PORTAL_PERMISSION_CATEGORY,),
    )

    return sorted(row["code"] for row in cursor.fetchall())


def role_is_portal_role(role_code: str | None, data_scope: str | None) -> bool:
    return (
        str(role_code or "").strip().upper() == CLIENT_PORTAL_ROLE
        or str(data_scope or "").strip().upper() == DATA_SCOPE_CLIENT
    )


def ensure_role_permission_audience(
    cursor,
    *,
    is_portal_role: bool,
    permission_codes: set[str],
):
    """
    Роль портала и роль сотрудника не смешиваются.

    Права portal.* у сотрудника не работают вообще: can_access_portal
    требует клиентскую учётку. А любое право CRM у роли портала — это
    доступ внешнего человека к внутренним данным.

    На шаге 311 то же правило закрыли для индивидуальных переопределений
    пользователя. Здесь — уровень роли, который я тогда пропустил.
    """
    portal_codes = set(filter_portal_permission_codes(cursor, permission_codes))

    if is_portal_role:
        foreign_codes = sorted(permission_codes - portal_codes)

        if foreign_codes:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Роли клиентского портала можно выдать только права раздела "
                    "«Клиентский портал». Лишние коды: " + ", ".join(foreign_codes)
                ),
            )

        return

    if portal_codes:
        raise HTTPException(
            status_code=400,
            detail=(
                "Права клиентского портала нельзя выдать роли сотрудника: "
                + ", ".join(sorted(portal_codes))
            ),
        )


def is_ui_alias_permission(permission: dict) -> bool:
    """
    Returns True for permission rows that must stay active in DB/back-end checks
    but should be hidden from admin UI checklists to avoid duplicate checkboxes.
    """
    code = str(permission.get("code") or "").strip()
    description = str(permission.get("description") or "").strip().lower()

    if code in UI_HIDDEN_PERMISSION_CODES:
        return True

    return description.startswith("алиас") or "алиас доступа" in description


def build_permissions_ui_payload(
    permissions: list[dict],
    audience: str = PERMISSIONS_AUDIENCE_EMPLOYEE,
) -> dict:
    visible_permissions = []
    hidden_permissions = []
    grouped = {}

    for permission in permissions:
        permission["is_dangerous"] = bool(permission["is_dangerous"])
        permission["is_system"] = bool(permission["is_system"])
        permission["is_active"] = bool(permission["is_active"])
        permission["is_portal"] = is_portal_permission(permission)

        if is_ui_alias_permission(permission):
            hidden_permissions.append(permission)
            continue

        if (
            audience == PERMISSIONS_AUDIENCE_EMPLOYEE
            and permission["is_portal"]
        ):
            hidden_permissions.append(permission)
            continue

        if (
            audience == PERMISSIONS_AUDIENCE_PORTAL
            and not permission["is_portal"]
        ):
            hidden_permissions.append(permission)
            continue

        visible_permissions.append(permission)
        grouped.setdefault(permission["category"], []).append(permission)

    return {
        "audience": audience,
        "permissions": visible_permissions,
        "grouped": grouped,
        "hidden_permissions_count": len(hidden_permissions),
    }


def ensure_super_admin_access(current_user: dict):
    if not is_super_admin(current_user):
        raise HTTPException(
            status_code=403,
            detail="Только Супер-Админ может управлять ролями и доступами",
        )


def normalize_role_code(value: str) -> str:
    return str(value or "").strip().upper()


def validate_role_code(role_code: str):
    if not ROLE_CODE_RE.match(role_code):
        raise HTTPException(
            status_code=400,
            detail="Код роли должен содержать только A-Z, 0-9, _ и быть длиной 2-50 символов",
        )


def validate_badge_color(value: str):
    if not BADGE_COLOR_RE.match(str(value or "")):
        raise HTTPException(
            status_code=400,
            detail="Цвет бейджа должен быть в HEX формате #RRGGBB",
        )


def validate_data_scope(value: str):
    if value not in ALLOWED_DATA_SCOPES:
        raise HTTPException(status_code=400, detail="Некорректный data_scope")


def get_role_by_code(cursor, role_code: str) -> dict | None:
    cursor.execute(
        """
        SELECT
            r.id,
            r.code,
            r.name,
            r.description,
            r.badge_color,
            r.data_scope,
            r.is_system,
            r.is_active,
            r.can_be_request_executor,
            r.can_self_register,
            r.can_be_responsible_manager,
            r.sort_order,
            r.created_at,
            r.updated_at,

            COUNT(u.id) AS users_count
        FROM roles r
        LEFT JOIN users u
            ON u.role = r.code
            AND u.deleted_at IS NULL
        WHERE r.code = %s
        GROUP BY
            r.id,
            r.code,
            r.name,
            r.description,
            r.badge_color,
            r.data_scope,
            r.is_system,
            r.is_active,
            r.can_be_request_executor,
            r.can_self_register,
            r.can_be_responsible_manager,
            r.sort_order,
            r.created_at,
            r.updated_at
        LIMIT 1
        """,
        (role_code,),
    )

    role = cursor.fetchone()

    if not role:
        return None

    role["is_system"] = bool(role["is_system"])
    role["is_active"] = bool(role["is_active"])
    role["can_be_request_executor"] = bool(role["can_be_request_executor"])
    role["can_be_responsible_manager"] = bool(role["can_be_responsible_manager"])
    role["can_self_register"] = bool(role["can_self_register"])
    role["users_count"] = int(role["users_count"] or 0)

    return role


def get_role_permission_codes_snapshot(cursor, role_id: int) -> list[dict]:
    cursor.execute(
        """
        SELECT
            p.code,
            p.name,
            p.category,
            rp.is_locked_core
        FROM role_permissions rp
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = %s
        ORDER BY
            p.category ASC,
            p.sort_order ASC,
            p.code ASC
        """,
        (role_id,),
    )

    rows = cursor.fetchall()

    for row in rows:
        row["is_locked_core"] = bool(row["is_locked_core"])

    return rows


def get_active_permission_ids_by_codes(cursor, permission_codes: set[str]) -> dict[str, int]:
    if not permission_codes:
        return {}

    normalized_codes = {
        str(code or "").strip()
        for code in permission_codes
        if str(code or "").strip()
    }

    if not normalized_codes:
        return {}

    placeholders = ", ".join(["%s"] * len(normalized_codes))

    cursor.execute(
        f"""
        SELECT id, code
        FROM permissions
        WHERE code IN ({placeholders})
          AND is_active = 1
        """,
        tuple(normalized_codes),
    )

    rows = cursor.fetchall()
    found = {row["code"]: row["id"] for row in rows}
    missing = sorted(normalized_codes - set(found.keys()))

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Некорректные permission-коды: {', '.join(missing)}",
        )

    return found


def get_locked_core_permission_codes_for_role(cursor, role_id: int) -> set[str]:
    cursor.execute(
        """
        SELECT p.code
        FROM role_permissions rp
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = %s
          AND rp.is_locked_core = 1
          AND p.is_active = 1
        """,
        (role_id,),
    )

    return {row["code"] for row in cursor.fetchall()}


def normalize_permission_codes(value: list[str]) -> set[str]:
    return {
        str(code or "").strip()
        for code in value or []
        if str(code or "").strip()
    }

def parse_audit_json_value(value):
    if value is None:
        return None

    if isinstance(value, (dict, list)):
        return value

    try:
        return json.loads(value)
    except Exception:
        return value


def ensure_can_view_role_options(current_user: dict):
    """
    Справочник ролей нужен не только разделу ролей,
    но и карточке сотрудника / селектору роли.
    """
    if is_super_admin(current_user):
        return

    if has_any_permission(
        current_user,
        [
            "roles.view",
            "employees.view",
            "employees.manage",
            "employees.roles.change",
        ],
    ):
        return

    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для просмотра списка ролей",
    )


def ensure_can_view_access_audit(current_user: dict):
    """
    Audit log содержит чувствительные действия:
    выдача Супер-Админа, изменение ролей, индивидуальные доступы.
    Пока разрешаем только Супер-Админам.
    """
    if not is_super_admin(current_user):
        raise HTTPException(
            status_code=403,
            detail="Только Супер-Админ может просматривать историю доступов",
        )

def get_user_permission_overrides_snapshot(cursor, user_id: int) -> list[dict]:
    cursor.execute(
        """
        SELECT
            p.code,
            p.name,
            p.category,
            upo.effect,
            upo.reason,
            upo.created_at,
            upo.updated_at,
            created_by_user.name AS created_by_name,
            updated_by_user.name AS updated_by_name
        FROM user_permission_overrides upo
        INNER JOIN permissions p ON p.id = upo.permission_id
        LEFT JOIN users created_by_user ON created_by_user.id = upo.created_by
        LEFT JOIN users updated_by_user ON updated_by_user.id = upo.updated_by
        WHERE upo.user_id = %s
        ORDER BY
            p.category ASC,
            p.sort_order ASC,
            p.code ASC
        """,
        (user_id,),
    )

    return cursor.fetchall()


def get_user_security_flags_snapshot(cursor, user_id: int) -> dict:
    cursor.execute(
        """
        SELECT
            user_id,
            is_super_admin,
            super_admin_granted_by,
            is_owner,
            created_at,
            updated_at,
            updated_by
        FROM user_security_flags
        WHERE user_id = %s
        LIMIT 1
        """,
        (user_id,),
    )

    row = cursor.fetchone()

    if not row:
        return {
            "user_id": user_id,
            "is_super_admin": False,
            "super_admin_granted_by": None,
            "is_owner": False,
            "created_at": None,
            "updated_at": None,
            "updated_by": None,
        }

    row["is_super_admin"] = bool(row["is_super_admin"])
    row["is_owner"] = bool(row["is_owner"])

    return row


def count_active_super_admins(cursor) -> int:
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM users u
        INNER JOIN user_security_flags usf ON usf.user_id = u.id
        WHERE usf.is_super_admin = 1
          AND u.is_approved = 1
          AND u.is_active = 1
          AND u.deleted_at IS NULL
        """
    )

    row = cursor.fetchone()

    return int(row["count"] or 0)


def validate_permission_overrides_payload(data: UserPermissionOverridesUpdate) -> dict[str, str]:
    result = {}

    for item in data.overrides or []:
        permission_code = str(item.permission_code or "").strip()
        effect = str(item.effect or "").strip().upper()

        if not permission_code:
            raise HTTPException(
                status_code=400,
                detail="permission_code не может быть пустым",
            )

        if effect not in ["ALLOW", "DENY"]:
            raise HTTPException(
                status_code=400,
                detail="effect должен быть ALLOW или DENY",
            )

        if permission_code in result and result[permission_code] != effect:
            raise HTTPException(
                status_code=400,
                detail=f"Permission {permission_code} указан несколько раз с разными effect",
            )

        result[permission_code] = effect

    return result

@router.get("/permissions")
def get_permissions(
    audience: str = Query(PERMISSIONS_AUDIENCE_EMPLOYEE),
    current_user: dict = Depends(get_current_user),
):
    """
    Список permission-кодов для чек-листов.

    audience:
      employee — по умолчанию: всё, кроме портала. Это экраны сотрудников;
      portal   — только права портала. Нужен экрану роли CLIENT_PORTAL
                 в Settings и настройке клиентских учёток в карточке клиента;
      all      — весь каталог, для отладки и сверок.
    """
    ensure_can_view_access_control(current_user)

    normalized_audience = str(audience or "").strip().lower()

    if normalized_audience not in ALLOWED_PERMISSIONS_AUDIENCES:
        raise HTTPException(
            status_code=400,
            detail="Некорректный audience: допустимы employee, portal, all",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    code,
                    name,
                    description,
                    category,
                    is_dangerous,
                    is_system,
                    is_active,
                    sort_order
                FROM permissions
                WHERE is_active = 1
                ORDER BY
                    category ASC,
                    sort_order ASC,
                    code ASC
                """
            )

            permissions = cursor.fetchall()

            return build_permissions_ui_payload(
                permissions,
                audience=normalized_audience,
            )

    finally:
        connection.close()


@router.get("/roles")
def get_roles(current_user: dict = Depends(get_current_user)):
    """
    Список ролей с количеством сотрудников и количеством стандартных доступов.
    """
    ensure_can_view_access_control(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.code,
                    r.name,
                    r.description,
                    r.badge_color,
                    r.data_scope,
                    r.is_system,
                    r.is_active,
                    r.can_be_request_executor,
                    r.can_self_register,
                    r.can_be_responsible_manager,
                    r.sort_order,
                    r.created_at,
                    r.updated_at,

                    COUNT(DISTINCT u.id) AS users_count,
                    COUNT(DISTINCT rp.permission_id) AS permissions_count,
                    COALESCE(SUM(rp.is_locked_core), 0) AS locked_core_count
                FROM roles r
                LEFT JOIN users u
                    ON u.role = r.code
                    AND u.deleted_at IS NULL
                LEFT JOIN role_permissions rp
                    ON rp.role_id = r.id
                GROUP BY
                    r.id,
                    r.code,
                    r.name,
                    r.description,
                    r.badge_color,
                    r.data_scope,
                    r.is_system,
                    r.is_active,
                    r.can_be_request_executor,
                    r.can_self_register,
                    r.can_be_responsible_manager,
                    r.sort_order,
                    r.created_at,
                    r.updated_at
                ORDER BY
                    r.sort_order ASC,
                    r.name ASC
                """
            )

            roles = cursor.fetchall()

            for role in roles:
                role["is_system"] = bool(role["is_system"])
                role["is_active"] = bool(role["is_active"])
                role["can_be_request_executor"] = bool(role["can_be_request_executor"])
                role["can_be_responsible_manager"] = bool(
                    role["can_be_responsible_manager"]
                )
                role["can_self_register"] = bool(role["can_self_register"])
                role["users_count"] = int(role["users_count"] or 0)
                role["permissions_count"] = int(role["permissions_count"] or 0)
                role["locked_core_count"] = int(role["locked_core_count"] or 0)

            return roles

    finally:
        connection.close()


@router.get("/roles/{role_code}")
def get_role_detail(
    role_code: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Детали роли + стандартные permissions этой роли.
    """
    ensure_can_view_access_control(current_user)

    normalized_code = role_code.strip().upper()

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    id,
                    code,
                    name,
                    description,
                    badge_color,
                    data_scope,
                    is_system,
                    is_active,
                    can_be_request_executor,
                    can_self_register,
                    can_be_responsible_manager,
                    sort_order,
                    created_at,
                    updated_at
                FROM roles
                WHERE code = %s
                LIMIT 1
                """,
                (normalized_code,),
            )

            role = cursor.fetchone()

            if not role:
                raise HTTPException(status_code=404, detail="Роль не найдена")

            role["is_system"] = bool(role["is_system"])
            role["is_active"] = bool(role["is_active"])
            role["can_be_request_executor"] = bool(role["can_be_request_executor"])
            role["can_be_responsible_manager"] = bool(
                role["can_be_responsible_manager"]
            )
            role["can_self_register"] = bool(role["can_self_register"])

            cursor.execute(
                """
                SELECT
                    p.id,
                    p.code,
                    p.name,
                    p.description,
                    p.category,
                    p.is_dangerous,
                    p.is_active,
                    rp.is_locked_core
                FROM role_permissions rp
                INNER JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = %s
                ORDER BY
                    p.category ASC,
                    p.sort_order ASC,
                    p.code ASC
                """,
                (role["id"],),
            )

            role_permissions = cursor.fetchall()

            for permission in role_permissions:
                permission["is_dangerous"] = bool(permission["is_dangerous"])
                permission["is_active"] = bool(permission["is_active"])
                permission["is_locked_core"] = bool(permission["is_locked_core"])

            cursor.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    city,
                    user_kind,
                    client_id,
                    is_active,
                    is_approved,
                    deleted_at
                FROM users
                WHERE role = %s
                  AND user_kind = 'EMPLOYEE'
                ORDER BY
                    deleted_at IS NOT NULL ASC,
                    is_active DESC,
                    name ASC
                """,
                (normalized_code,),
            )

            users = cursor.fetchall()

            for user in users:
                user["is_active"] = bool(user["is_active"])
                user["is_approved"] = bool(user["is_approved"])

            return {
                "role": role,
                "permissions": role_permissions,
                "users": users,
            }

    finally:
        connection.close()


@router.get("/users/{user_id}")
def get_user_access_detail(
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Доступы конкретного пользователя:
    - роль
    - security flags
    - effective permissions
    - role permissions
    - individual overrides
    """
    ensure_can_view_access_control(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_base_access(cursor, user_id)

            if not user:
                raise HTTPException(status_code=404, detail="Пользователь не найден")

            attach_effective_permissions(cursor, user)

            security_flags = get_user_security_flags_snapshot(cursor, user_id)

            cursor.execute(
                """
                SELECT
                    p.code,
                    p.name,
                    p.description,
                    p.category,
                    p.is_dangerous,
                    rp.is_locked_core
                FROM role_permissions rp
                INNER JOIN roles r ON r.id = rp.role_id
                INNER JOIN permissions p ON p.id = rp.permission_id
                WHERE r.code = %s
                  AND p.is_active = 1
                ORDER BY
                    p.category ASC,
                    p.sort_order ASC,
                    p.code ASC
                """,
                (user["role"],),
            )

            role_permissions = cursor.fetchall()

            for permission in role_permissions:
                permission["is_dangerous"] = bool(permission["is_dangerous"])
                permission["is_locked_core"] = bool(permission["is_locked_core"])

            cursor.execute(
                """
                SELECT
                    upo.id,
                    p.code,
                    p.name,
                    p.description,
                    p.category,
                    p.is_dangerous,
                    upo.effect,
                    upo.reason,
                    upo.created_at,
                    upo.updated_at,
                    created_by_user.name AS created_by_name,
                    updated_by_user.name AS updated_by_name
                FROM user_permission_overrides upo
                INNER JOIN permissions p ON p.id = upo.permission_id
                LEFT JOIN users created_by_user ON created_by_user.id = upo.created_by
                LEFT JOIN users updated_by_user ON updated_by_user.id = upo.updated_by
                WHERE upo.user_id = %s
                  AND p.is_active = 1
                ORDER BY
                    p.category ASC,
                    p.sort_order ASC,
                    p.code ASC
                """,
                (user_id,),
            )

            overrides = cursor.fetchall()

            for override in overrides:
                override["is_dangerous"] = bool(override["is_dangerous"])

            return {
                "user": {
                    "id": user["id"],
                    "email": user["email"],
                    "name": user["name"],
                    "role": user["role"],
                    "role_name": user["role_name"],
                    "role_badge_color": user["role_badge_color"],
                    "data_scope": user["data_scope"],
                    "city": user["city"],
                    "is_approved": bool(user["is_approved"]),
                    "is_active": bool(user["is_active"]),
                    "deleted_at": user["deleted_at"],
                    "is_super_admin": user["is_super_admin"],
                    "super_admin_granted_by": security_flags.get(
                        "super_admin_granted_by"
                    ),
                    "is_owner": user["is_owner"],
                    "can_be_request_executor": user["can_be_request_executor"],
                    "can_be_responsible_manager": user["can_be_responsible_manager"],
                    "permissions": user["permissions"],
                    "locked_core_permissions": user["locked_core_permissions"],
                },
                "role_permissions": role_permissions,
                "overrides": overrides,
            }

    finally:
        connection.close()

@router.post("/roles")
def create_role(
    data: RoleCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Создание новой пользовательской роли.
    Системные роли через API не создаются.
    """
    ensure_super_admin_access(current_user)

    role_code = normalize_role_code(data.code)
    validate_role_code(role_code)

    name = str(data.name or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Название роли не может быть пустым")

    badge_color = str(data.badge_color or "#64748B").strip()
    validate_badge_color(badge_color)

    data_scope = str(data.data_scope or "NONE").strip().upper()
    validate_data_scope(data_scope)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            if get_role_by_code(cursor, role_code):
                raise HTTPException(
                    status_code=409,
                    detail="Роль с таким кодом уже существует",
                )

            cursor.execute(
                """
                INSERT INTO roles (
                    code,
                    name,
                    description,
                    badge_color,
                    data_scope,
                    is_system,
                    is_active,
                    can_be_request_executor,
                    can_be_responsible_manager,
                    can_self_register,
                    sort_order,
                    created_by,
                    updated_by
                )
                VALUES (%s, %s, %s, %s, %s, 0, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    role_code,
                    name,
                    data.description,
                    badge_color,
                    data_scope,
                    bool(data.is_active),
                    bool(data.can_be_request_executor),
                    bool(data.can_be_responsible_manager),
                    bool(data.can_self_register),
                    int(data.sort_order or 100),
                    current_user["id"],
                    current_user["id"],
                ),
            )

            role_id = cursor.lastrowid

            permission_codes = normalize_permission_codes(data.permission_codes)
            permission_codes = expand_permissions_with_dependencies(cursor, permission_codes)

            # Новая роль с областью CLIENT — это вторая роль портала.
            # Ей тоже нельзя выдавать права CRM.
            ensure_role_permission_audience(
                cursor,
                is_portal_role=role_is_portal_role(role_code, data_scope),
                permission_codes=permission_codes,
            )

            permission_ids_by_code = get_active_permission_ids_by_codes(
                cursor,
                permission_codes,
            )

            for permission_code in sorted(permission_ids_by_code.keys()):
                cursor.execute(
                    """
                    INSERT INTO role_permissions (
                        role_id,
                        permission_id,
                        is_locked_core
                    )
                    VALUES (%s, %s, 0)
                    ON DUPLICATE KEY UPDATE
                        updated_at = NOW()
                    """,
                    (
                        role_id,
                        permission_ids_by_code[permission_code],
                    ),
                )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_role_id=role_id,
                action="ROLE_CREATED",
                old_value=None,
                new_value={
                    "code": role_code,
                    "name": name,
                    "description": data.description,
                    "badge_color": badge_color,
                    "data_scope": data_scope,
                    "is_active": bool(data.is_active),
                    "can_be_request_executor": bool(data.can_be_request_executor),
                    "can_be_responsible_manager": bool(data.can_be_responsible_manager),
                    "can_self_register": bool(data.can_self_register),
                    "sort_order": int(data.sort_order or 100),
                    "permission_codes": sorted(permission_codes),
                },
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Роль создана",
                "role_code": role_code,
                "role_id": role_id,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/roles/{role_code}")
def update_role(
    role_code: str,
    data: RoleUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Редактирование роли.

    Для системных ролей запрещено менять:
    - data_scope
    - is_active
    - can_be_request_executor
    - can_be_responsible_manager

    Это защищает текущую бизнес-логику.
    """
    ensure_super_admin_access(current_user)

    normalized_code = normalize_role_code(role_code)
    incoming = data.dict(exclude_unset=True)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            role = get_role_by_code(cursor, normalized_code)

            if not role:
                raise HTTPException(status_code=404, detail="Роль не найдена")

            old_value = dict(role)

            if role["is_system"]:
                for field in SYSTEM_ROLE_PROTECTED_FIELDS:
                    if field not in incoming:
                        continue

                    incoming_value = incoming[field]

                    if field in [
                        "is_active",
                        "can_be_request_executor",
                        "can_be_responsible_manager",
                    ]:
                        incoming_value = bool(incoming_value)
                        current_value = bool(role[field])
                    else:
                        incoming_value = str(incoming_value or "").strip().upper()
                        current_value = str(role[field] or "").strip().upper()

                    if incoming_value != current_value:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Поле {field} нельзя менять у системной роли. "
                                "Это может сломать бизнес-логику."
                            ),
                        )

            updates = []
            values = []

            if "name" in incoming:
                name = str(incoming["name"] or "").strip()

                if not name:
                    raise HTTPException(
                        status_code=400,
                        detail="Название роли не может быть пустым",
                    )

                updates.append("name = %s")
                values.append(name)

            if "description" in incoming:
                updates.append("description = %s")
                values.append(incoming["description"])

            if "badge_color" in incoming:
                badge_color = str(incoming["badge_color"] or "").strip()
                validate_badge_color(badge_color)

                updates.append("badge_color = %s")
                values.append(badge_color)

            if "data_scope" in incoming and not role["is_system"]:
                data_scope = str(incoming["data_scope"] or "").strip().upper()
                validate_data_scope(data_scope)

                updates.append("data_scope = %s")
                values.append(data_scope)

            if "is_active" in incoming and not role["is_system"]:
                new_is_active = bool(incoming["is_active"])

                if not new_is_active and role["users_count"] > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Нельзя отключить роль, которая назначена сотрудникам. "
                            "Сначала переназначьте сотрудников на другую роль."
                        ),
                    )

                updates.append("is_active = %s")
                values.append(new_is_active)

            if "can_be_request_executor" in incoming and not role["is_system"]:
                updates.append("can_be_request_executor = %s")
                values.append(bool(incoming["can_be_request_executor"]))

            if "can_be_responsible_manager" in incoming and not role["is_system"]:
                updates.append("can_be_responsible_manager = %s")
                values.append(bool(incoming["can_be_responsible_manager"]))

            if "can_self_register" in incoming:
                updates.append("can_self_register = %s")
                values.append(bool(incoming["can_self_register"]))

            if "sort_order" in incoming:
                updates.append("sort_order = %s")
                values.append(int(incoming["sort_order"] or 100))

            if not updates:
                return {"message": "Нет изменений"}

            updates.append("updated_by = %s")
            values.append(current_user["id"])

            values.append(role["id"])

            cursor.execute(
                f"""
                UPDATE roles
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values),
            )

            updated_role = get_role_by_code(cursor, normalized_code)

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_role_id=role["id"],
                action="ROLE_UPDATED",
                old_value=old_value,
                new_value=updated_role,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Роль обновлена",
                "role_code": normalized_code,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/roles/{role_code}")
def delete_role(
    role_code: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Удаление только пользовательских ролей.
    Системные роли удалять нельзя.
    Роль, назначенную сотрудникам, удалять нельзя.
    """
    ensure_super_admin_access(current_user)

    normalized_code = normalize_role_code(role_code)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            role = get_role_by_code(cursor, normalized_code)

            if not role:
                raise HTTPException(status_code=404, detail="Роль не найдена")

            if role["is_system"]:
                raise HTTPException(
                    status_code=400,
                    detail="Системную роль нельзя удалить",
                )

            if role["users_count"] > 0:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Нельзя удалить роль, которая назначена сотрудникам. "
                        "Сначала переназначьте сотрудников на другую роль."
                    ),
                )

            old_permissions = get_role_permission_codes_snapshot(cursor, role["id"])

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_role_id=role["id"],
                action="ROLE_DELETED",
                old_value={
                    "role": role,
                    "permissions": old_permissions,
                },
                new_value=None,
                reason="Role deleted",
            )

            cursor.execute(
                """
                DELETE FROM roles
                WHERE id = %s
                """,
                (role["id"],),
            )

            connection.commit()

            return {
                "message": "Роль удалена",
                "role_code": normalized_code,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/roles/{role_code}/permissions")
def update_role_permissions(
    role_code: str,
    data: RolePermissionsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Замена стандартного пакета доступов роли.

    Для системных ролей нельзя убрать LOCKED_CORE permissions.
    Dependencies добавляются автоматически.
    """
    ensure_super_admin_access(current_user)

    normalized_code = normalize_role_code(role_code)
    requested_codes = normalize_permission_codes(data.permission_codes)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            role = get_role_by_code(cursor, normalized_code)

            if not role:
                raise HTTPException(status_code=404, detail="Роль не найдена")

            ensure_role_permission_audience(
                cursor,
                is_portal_role=role_is_portal_role(
                    role.get("code"),
                    role.get("data_scope"),
                ),
                permission_codes=requested_codes,
            )

            locked_core_codes = get_locked_core_permission_codes_for_role(
                cursor,
                role["id"],
            )

            if role["is_system"]:
                missing_locked = sorted(locked_core_codes - requested_codes)

                if missing_locked:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Нельзя убрать обязательные доступы системной роли: "
                            + ", ".join(missing_locked)
                        ),
                    )

            final_codes = expand_permissions_with_dependencies(cursor, requested_codes)
            permission_ids_by_code = get_active_permission_ids_by_codes(
                cursor,
                final_codes,
            )

            old_permissions = get_role_permission_codes_snapshot(cursor, role["id"])

            # Удаляем только обычные права. LOCKED_CORE не трогаем.
            cursor.execute(
                """
                DELETE FROM role_permissions
                WHERE role_id = %s
                  AND is_locked_core = 0
                """,
                (role["id"],),
            )

            for permission_code in sorted(final_codes):
                cursor.execute(
                    """
                    INSERT INTO role_permissions (
                        role_id,
                        permission_id,
                        is_locked_core
                    )
                    VALUES (%s, %s, 0)
                    ON DUPLICATE KEY UPDATE
                        updated_at = NOW()
                    """,
                    (
                        role["id"],
                        permission_ids_by_code[permission_code],
                    ),
                )

            new_permissions = get_role_permission_codes_snapshot(cursor, role["id"])

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_role_id=role["id"],
                action="ROLE_PERMISSIONS_UPDATED",
                old_value=old_permissions,
                new_value=new_permissions,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Стандартные доступы роли обновлены",
                "role_code": normalized_code,
                "permissions_count": len(new_permissions),
                "locked_core_count": len(locked_core_codes),
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/users/{user_id}/permission-overrides")
def update_user_permission_overrides(
    user_id: int,
    data: UserPermissionOverridesUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Полная замена индивидуальных доступов пользователя.

    Логика:
    - overrides = [] означает сбросить индивидуальные настройки;
    - ALLOW добавляет право поверх роли;
    - DENY убирает право из роли;
    - DENY не может отключить LOCKED_CORE;
    - у OWNER и SUPER_ADMIN индивидуальные permissions не редактируем.
    """
    ensure_super_admin_access(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            target_user = get_user_base_access(cursor, user_id)

            if not target_user:
                raise HTTPException(status_code=404, detail="Пользователь не найден")

            if target_user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять доступы удалённого пользователя",
                )

            if target_user.get("is_owner"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять индивидуальные доступы владельца системы",
                )

            if target_user.get("is_super_admin"):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "У Супер-Админа индивидуальные доступы не редактируются, "
                        "он получает все активные permissions"
                    ),
                )

            # Граница первая: клиентские учётки настраиваются в карточке
            # клиента, а не здесь. Два экрана для одного и того же неизбежно
            # разъедутся, и разойдутся они молча.
            if is_client_user(target_user):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Это учётная запись клиентского портала. Доступы "
                        "настраиваются в карточке клиента, вкладка "
                        "«Настройка пользователей»."
                    ),
                )

            overrides_by_code = validate_permission_overrides_payload(data)
            requested_codes = set(overrides_by_code.keys())

            # Граница вторая: сотруднику права портала не выдаются.
            # Они всё равно не сработают (can_access_portal требует
            # клиентскую учётку), но в списке доступов выглядели бы
            # как выданный доступ.
            portal_codes = filter_portal_permission_codes(cursor, requested_codes)

            if portal_codes:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Права клиентского портала нельзя выдать сотруднику: "
                        + ", ".join(portal_codes)
                    ),
                )

            permission_ids_by_code = get_active_permission_ids_by_codes(
                cursor,
                requested_codes,
            )

            locked_core_codes = get_locked_core_permission_codes_for_role(
                cursor,
                target_user["role_id"],
            )

            denied_locked = sorted(
                code
                for code, effect in overrides_by_code.items()
                if effect == "DENY" and code in locked_core_codes
            )

            if denied_locked:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Нельзя отключить обязательные доступы роли: "
                        + ", ".join(denied_locked)
                    ),
                )

            old_overrides = get_user_permission_overrides_snapshot(cursor, user_id)

            cursor.execute(
                """
                DELETE FROM user_permission_overrides
                WHERE user_id = %s
                """,
                (user_id,),
            )

            for permission_code, effect in sorted(overrides_by_code.items()):
                cursor.execute(
                    """
                    INSERT INTO user_permission_overrides (
                        user_id,
                        permission_id,
                        effect,
                        reason,
                        created_by,
                        updated_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        permission_ids_by_code[permission_code],
                        effect,
                        data.reason,
                        current_user["id"],
                        current_user["id"],
                    ),
                )

            new_overrides = get_user_permission_overrides_snapshot(cursor, user_id)

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_PERMISSION_OVERRIDES_UPDATED",
                old_value=old_overrides,
                new_value=new_overrides,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Индивидуальные доступы пользователя обновлены",
                "user_id": user_id,
                "overrides_count": len(new_overrides),
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.patch("/users/{user_id}/security-flags")
def update_user_security_flags(
    user_id: int,
    data: UserSecurityFlagsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Изменение security flags пользователя.

    Сейчас разрешаем менять только is_super_admin.
    is_owner через API не меняется.
    """
    ensure_super_admin_access(current_user)

    if data.is_super_admin is None:
        return {"message": "Нет изменений"}

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            target_user = get_user_base_access(cursor, user_id)

            if not target_user:
                raise HTTPException(status_code=404, detail="Пользователь не найден")

            if target_user.get("deleted_at") is not None or target_user.get("is_active") == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять Супер-Админа у удалённого или отключённого пользователя",
                )

            if not target_user.get("is_approved"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя выдать Супер-Админа неподтверждённому пользователю",
                )

            # Супер-админ получает ВСЕ активные права системы
            # (get_effective_permissions). Для внешнего человека это
            # означало бы полный доступ к CRM, поэтому клиентской
            # учётной записи флаг не выдаётся вообще.
            if is_client_user(target_user):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Клиентской учётной записи нельзя выдать Супер-Админа: "
                        "она получила бы все права системы."
                    ),
                )

            old_flags = get_user_security_flags_snapshot(cursor, user_id)

            new_is_super_admin = bool(data.is_super_admin)

            if target_user.get("is_owner") and not new_is_super_admin:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя снять Супер-Админа с владельца системы",
                )

            if int(user_id) == int(current_user["id"]) and not new_is_super_admin:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя снять Супер-Админа с самого себя",
                )

            if old_flags["is_super_admin"] and not new_is_super_admin:
                granted_by = old_flags.get("super_admin_granted_by")

                # Снять может тот, кто выдал. Владелец системы — всегда,
                # в том числе если выдавший сам уже не Супер-Админ или удалён.
                if not is_owner(current_user) and (
                    granted_by is None
                    or int(granted_by) != int(current_user["id"])
                ):
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "Снять Супер-Админа может только тот, кто его выдал, "
                            "или владелец системы"
                        ),
                    )

            if old_flags["is_super_admin"] and not new_is_super_admin:
                active_super_admins_count = count_active_super_admins(cursor)

                if active_super_admins_count <= 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Нельзя оставить систему без активного Супер-Админа",
                    )

            if new_is_super_admin:
                # При повторной выдаче кураторство не переписываем,
                # иначе Супер-Админа можно было бы «перехватить» лишним PATCH.
                granted_by_value = (
                    old_flags.get("super_admin_granted_by")
                    if old_flags["is_super_admin"]
                    else current_user["id"]
                )
            else:
                granted_by_value = None

            cursor.execute(
                """
                INSERT INTO user_security_flags (
                    user_id,
                    is_super_admin,
                    super_admin_granted_by,
                    is_owner,
                    created_at,
                    updated_at,
                    updated_by
                )
                VALUES (%s, %s, %s, 0, NOW(), NOW(), %s)
                ON DUPLICATE KEY UPDATE
                    is_super_admin = VALUES(is_super_admin),
                    super_admin_granted_by = VALUES(super_admin_granted_by),
                    updated_at = NOW(),
                    updated_by = VALUES(updated_by)
                """,
                (
                    user_id,
                    new_is_super_admin,
                    granted_by_value,
                    current_user["id"],
                ),
            )

            new_flags = get_user_security_flags_snapshot(cursor, user_id)

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action=(
                    "SUPER_ADMIN_GRANTED"
                    if new_is_super_admin
                    else "SUPER_ADMIN_REVOKED"
                ),
                old_value=old_flags,
                new_value=new_flags,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": (
                    "Супер-Админ выдан"
                    if new_is_super_admin
                    else "Супер-Админ снят"
                ),
                "user_id": user_id,
                "is_super_admin": new_is_super_admin,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    data: UserRoleUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Смена роли пользователя через новую таблицу roles.

    Правила:
    - менять роль может только Супер-Админ;
    - OWNER менять роль нельзя;
    - роль должна существовать в roles;
    - роль должна быть активной;
    - если роль может быть исполнителем заявки, у пользователя должен быть город;
    - изменения пишутся в access_audit_log.
    """
    ensure_super_admin_access(current_user)

    normalized_role_code = normalize_role_code(data.role)
    validate_role_code(normalized_role_code)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            target_user = get_user_base_access(cursor, user_id)

            if not target_user:
                raise HTTPException(status_code=404, detail="Пользователь не найден")

            if target_user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять роль удалённого пользователя",
                )

            if target_user.get("is_owner"):
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя менять роль владельца системы",
                )

            role = get_role_by_code(cursor, normalized_role_code)

            if not role:
                raise HTTPException(status_code=404, detail="Роль не найдена")

            if not role["is_active"]:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя назначить отключённую роль",
                )

            # Роль портала и учётка клиента должны совпадать в обе стороны.
            # База это не поймает: CHECK следит за парой user_kind/client_id,
            # а роль ему безразлична. Без этой проверки сотрудник с ролью
            # портала теряет склад, отчёты и списки людей, оставаясь
            # сотрудником, и понять причину будет трудно.
            role_is_portal = (
                str(role.get("data_scope") or "").strip().upper() == DATA_SCOPE_CLIENT
                or normalized_role_code == CLIENT_PORTAL_ROLE
            )

            target_is_client_user = (
                str(target_user.get("user_kind") or "").strip().upper()
                == USER_KIND_CLIENT
            )

            if role_is_portal and not target_is_client_user:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Роль клиентского портала можно назначить только учётной "
                        "записи клиента. Этот пользователь — сотрудник."
                    ),
                )

            if target_is_client_user and not role_is_portal:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Учётной записи клиента можно назначить только роль "
                        "клиентского портала."
                    ),
                )

            incoming = data.dict(exclude_unset=True)

            new_city = target_user.get("city")

            if "city" in incoming:
                new_city = incoming.get("city")

            if new_city is not None:
                new_city = str(new_city).strip() or None

            if role["can_be_request_executor"] and not new_city:
                raise HTTPException(
                    status_code=400,
                    detail="Для роли исполнителя заявки необходимо указать город",
                )

            old_value = {
                "user_id": target_user["id"],
                "email": target_user["email"],
                "name": target_user["name"],
                "role": target_user["role"],
                "role_name": target_user["role_name"],
                "city": target_user["city"],
            }

            cursor.execute(
                """
                UPDATE users
                SET role = %s,
                    city = %s
                WHERE id = %s
                """,
                (
                    normalized_role_code,
                    new_city,
                    user_id,
                ),
            )

            updated_user = get_user_base_access(cursor, user_id)
            attach_effective_permissions(cursor, updated_user)

            new_value = {
                "user_id": updated_user["id"],
                "email": updated_user["email"],
                "name": updated_user["name"],
                "role": updated_user["role"],
                "role_name": updated_user["role_name"],
                "city": updated_user["city"],
                "permissions": updated_user["permissions"],
            }

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="USER_ROLE_CHANGED",
                old_value=old_value,
                new_value=new_value,
                reason=data.reason,
            )

            connection.commit()

            return {
                "message": "Роль пользователя обновлена",
                "user": {
                    "id": updated_user["id"],
                    "email": updated_user["email"],
                    "name": updated_user["name"],
                    "role": updated_user["role"],
                    "role_name": updated_user["role_name"],
                    "role_badge_color": updated_user["role_badge_color"],
                    "data_scope": updated_user["data_scope"],
                    "city": updated_user["city"],
                    "is_super_admin": updated_user["is_super_admin"],
                    "is_owner": updated_user["is_owner"],
                    "permissions": updated_user["permissions"],
                    "locked_core_permissions": updated_user["locked_core_permissions"],
                    "can_be_request_executor": updated_user["can_be_request_executor"],
                    "can_be_responsible_manager": updated_user["can_be_responsible_manager"],
                },
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@router.get("/role-options")
def get_role_options(current_user: dict = Depends(get_current_user)):
    """
    Удобный список активных ролей для frontend-селекторов.
    Не конфликтует с /access/roles/{role_code}.
    """
    ensure_can_view_role_options(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.id,
                    r.code,
                    r.name,
                    r.description,
                    r.badge_color,
                    r.data_scope,
                    r.is_system,
                    r.is_active,
                    r.can_be_request_executor,
                    r.can_self_register,
                    r.can_be_responsible_manager,
                    r.sort_order,

                    COUNT(u.id) AS users_count
                FROM roles r
                LEFT JOIN users u
                    ON u.role = r.code
                    AND u.deleted_at IS NULL
                WHERE r.is_active = 1
                GROUP BY
                    r.id,
                    r.code,
                    r.name,
                    r.description,
                    r.badge_color,
                    r.data_scope,
                    r.is_system,
                    r.is_active,
                    r.can_be_request_executor,
                    r.can_self_register,
                    r.can_be_responsible_manager,
                    r.sort_order
                ORDER BY
                    r.sort_order ASC,
                    r.name ASC
                """
            )

            roles = cursor.fetchall()

            for role in roles:
                role["is_system"] = bool(role["is_system"])
                role["is_active"] = bool(role["is_active"])
                role["can_be_request_executor"] = bool(role["can_be_request_executor"])
                role["can_be_responsible_manager"] = bool(
                    role["can_be_responsible_manager"]
                )
                role["can_self_register"] = bool(role["can_self_register"])
                role["users_count"] = int(role["users_count"] or 0)

            return roles

    finally:
        connection.close()


@router.get("/data-scopes")
def get_data_scopes(current_user: dict = Depends(get_current_user)):
    """
    Справочник data_scope для frontend.
    """
    ensure_can_view_access_control(current_user)

    return [
        {
            "code": "ALL",
            "name": "Все данные",
            "description": "Пользователь работает со всеми данными CRM",
        },
        {
            "code": "CITY",
            "name": "Только свой город",
            "description": "Пользователь работает только с данными своего города",
        },
        {
            "code": "RESPONSIBLE_CLIENTS",
            "name": "Свои клиенты",
            "description": "Пользователь работает с клиентами, где он создатель или ответственный",
        },
        {
            "code": "ASSIGNED",
            "name": "Назначенное",
            "description": "Пользователь работает только с назначенными ему сущностями",
        },
        {
            "code": "CITY_ASSIGNED",
            "name": "Свой город и назначенное",
            "description": "Для исполнителей: свой город, свободные/назначенные заявки и свои работы",
        },
        {
            "code": "OWN",
            "name": "Только своё",
            "description": "Пользователь работает только со своими сущностями",
        },
        {
            "code": "NONE",
            "name": "Без области данных",
            "description": "Нет автоматической области доступа к данным",
        },
        {
            "code": "CLIENT",
            "name": "Клиентский портал",
            "description": (
                "Только для учётных записей клиентов: пользователь видит "
                "своего клиента и его подклиентов. Сотруднику такую роль "
                "назначить нельзя."
            ),
        },
    ]


@router.get("/audit-log")
def get_access_audit_log(
    action: str | None = Query(None),
    actor_user_id: int | None = Query(None),
    target_user_id: int | None = Query(None),
    target_role_id: int | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    """
    История изменений ролей, доступов, пользователей и security flags.
    """
    ensure_can_view_access_audit(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            conditions = []
            values = []

            if action:
                conditions.append("aal.action = %s")
                values.append(action.strip())

            if actor_user_id is not None:
                conditions.append("aal.actor_user_id = %s")
                values.append(actor_user_id)

            if target_user_id is not None:
                conditions.append("aal.target_user_id = %s")
                values.append(target_user_id)

            if target_role_id is not None:
                conditions.append("aal.target_role_id = %s")
                values.append(target_role_id)

            if date_from is not None:
                conditions.append("aal.created_at >= %s")
                values.append(date_from.replace(tzinfo=None))

            if date_to is not None:
                conditions.append("aal.created_at <= %s")
                values.append(date_to.replace(tzinfo=None))

            where_clause = ""

            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)

            values.append(limit)

            cursor.execute(
                f"""
                SELECT
                    aal.id,
                    aal.actor_user_id,
                    actor.name AS actor_name,
                    actor.email AS actor_email,

                    aal.target_user_id,
                    target_user.name AS target_user_name,
                    target_user.email AS target_user_email,

                    aal.target_role_id,
                    target_role.code AS target_role_code,
                    target_role.name AS target_role_name,

                    aal.action,
                    aal.old_value,
                    aal.new_value,
                    aal.reason,
                    aal.created_at
                FROM access_audit_log aal
                LEFT JOIN users actor ON actor.id = aal.actor_user_id
                LEFT JOIN users target_user ON target_user.id = aal.target_user_id
                LEFT JOIN roles target_role ON target_role.id = aal.target_role_id
                {where_clause}
                ORDER BY aal.created_at DESC, aal.id DESC
                LIMIT %s
                """,
                tuple(values),
            )

            rows = cursor.fetchall()

            for row in rows:
                row["old_value"] = parse_audit_json_value(row.get("old_value"))
                row["new_value"] = parse_audit_json_value(row.get("new_value"))

            return rows

    finally:
        connection.close()