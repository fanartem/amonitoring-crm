"""
Учётные записи клиентского портала.

Отдельный роутер, а не часть clients.py: там уже больше трёх тысяч строк,
и заведение учёток — это работа с пользователями, а не с карточкой клиента.
Префикс тот же (/clients), потому что учётка живёт внутри клиента и
без него не существует.

Границы ответственности:
  - здесь заводят, отключают, меняют пароль и настраивают галочки
    доступов конкретной учётной записи портала;
  - в Settings у роли CLIENT_PORTAL задаётся только СТАНДАРТ — набор,
    который получает каждая новая учётка. Список пользователей роли там
    намеренно пустой;
  - сотрудники управляются в admin.py, и admin.py явно отказывается
    трогать клиентские учётки;
  - сотрудничий экран индивидуальных доступов (access_control.py) для
    клиентских учёток закрыт, а права portal.* сотруднику не выдаются.

Модель галочек. В базе лежат не галочки, а отклонения от стандарта роли
(user_permission_overrides). Пересчёт в обе стороны делает бэкенд:

    галочка стоит,  в стандарте есть   → ничего не пишем
    галочка снята,  в стандарте есть   → DENY
    галочка стоит,  в стандарте нет    → ALLOW
    галочка снята,  в стандарте нет    → ничего не пишем

Так администратор видит просто набор прав, а не разницу с чем-то.
"""

from fastapi import APIRouter, Depends, HTTPException
from pymysql.err import IntegrityError

from app.database import get_connection
from app.security import get_current_user, hash_password
from app.schemas import (
    PortalUserCreate,
    PortalUserPasswordSet,
    PortalUserPermissionsUpdate,
    PortalUserUpdate,
)
from app.permissions import (
    CLIENT_PORTAL_ROLE,
    USER_KIND_CLIENT,
    add_access_audit_log,
    add_client_history,
    can_open_client_details,
    has_any_permission,
    is_super_admin,
    require_employee_user,
)


def ensure_employee_access(current_user: dict = Depends(get_current_user)):
    """
    Клиент не заводит учётки — ни себе, ни своим подклиентам.
    Выдача доступа в систему остаётся за сотрудником.

    Если на этапе 6 решим дать это клиенту, право будет отдельным
    (portal.users.manage), а не расширением этого роутера.
    """
    require_employee_user(
        current_user,
        detail="Управление учётными записями портала доступно только сотрудникам",
    )

    return current_user


router = APIRouter(
    prefix="/clients",
    tags=["Portal Users"],
    dependencies=[Depends(ensure_employee_access)],
)


PORTAL_USERS_VIEW_PERMISSION_CODES = [
    "clients.portal_users.view",
    "clients.portal_users.manage",
]

PORTAL_USERS_MANAGE_PERMISSION_CODES = [
    "clients.portal_users.manage",
]

PORTAL_PERMISSION_CATEGORY = "portal"

PERMISSION_EFFECT_ALLOW = "ALLOW"
PERMISSION_EFFECT_DENY = "DENY"

MIN_PORTAL_PASSWORD_LENGTH = 8
MAX_PORTAL_PASSWORD_LENGTH = 128


# ---------------------------------------------------------------------------
# Проверки прав
# ---------------------------------------------------------------------------

def ensure_portal_users_view(current_user: dict):
    if is_super_admin(current_user):
        return

    if has_any_permission(current_user, PORTAL_USERS_VIEW_PERMISSION_CODES):
        return

    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для просмотра учётных записей портала",
    )


def ensure_portal_users_manage(current_user: dict):
    if is_super_admin(current_user):
        return

    if has_any_permission(current_user, PORTAL_USERS_MANAGE_PERMISSION_CODES):
        return

    raise HTTPException(
        status_code=403,
        detail="Недостаточно прав для управления учётными записями портала",
    )


# ---------------------------------------------------------------------------
# Валидация входных данных
# ---------------------------------------------------------------------------

def normalize_portal_email(value) -> str:
    """
    Логин учётной записи портала.

    Формат — почта, но домен любой: у части клиентов своей почты нет, и
    админ придумывает адрес на нашем домене. Поэтому проверяем только то,
    что собака одна, обе части непустые и внутри нет пробелов.
    Более строгая проверка отсекла бы придуманные адреса.
    """
    email = str(value or "").strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail="Укажите email учётной записи")

    if len(email) > 255:
        raise HTTPException(status_code=400, detail="Email слишком длинный")

    if any(symbol.isspace() for symbol in email):
        raise HTTPException(
            status_code=400,
            detail="Email не должен содержать пробелов",
        )

    if email.count("@") != 1:
        raise HTTPException(
            status_code=400,
            detail="Email должен содержать один символ @",
        )

    local_part, _, domain_part = email.partition("@")

    if not local_part or not domain_part:
        raise HTTPException(
            status_code=400,
            detail="Email указан не полностью",
        )

    return email


def validate_portal_password(value) -> str:
    password = str(value or "")

    if len(password) < MIN_PORTAL_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Пароль должен быть не короче {MIN_PORTAL_PASSWORD_LENGTH} символов",
        )

    if len(password) > MAX_PORTAL_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Пароль должен быть не длиннее {MAX_PORTAL_PASSWORD_LENGTH} символов",
        )

    if password.strip() != password:
        raise HTTPException(
            status_code=400,
            detail="Пароль не должен начинаться или заканчиваться пробелом",
        )

    return password


def normalize_portal_user_name(value) -> str:
    name = str(value or "").strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Укажите имя пользователя",
        )

    if len(name) > 255:
        raise HTTPException(status_code=400, detail="Имя слишком длинное")

    return name


def normalize_permission_codes(value) -> set[str]:
    return {
        str(code or "").strip()
        for code in value or []
        if str(code or "").strip()
    }


# ---------------------------------------------------------------------------
# Клиент и его учётки
# ---------------------------------------------------------------------------

def load_client_for_portal_users(cursor, client_id: int) -> dict | None:
    cursor.execute(
        """
        SELECT
            c.id,
            c.name,
            c.company_name,
            c.status,
            c.is_deleted,
            c.responsible_manager_id,
            c.created_by
        FROM clients c
        WHERE c.id = %s
        LIMIT 1
        """,
        (client_id,),
    )

    return cursor.fetchone()


def ensure_client_access(client: dict | None, current_user: dict) -> dict:
    """
    Учётку можно завести только тому клиенту, чью карточку сотрудник и так
    открывает. Отдельного «доступа к порталу поверх клиента» не вводим:
    два независимых правила доступа к одной сущности неизбежно разъедутся.
    """
    if not client:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    if not can_open_client_details(client, current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для работы с этим клиентом",
        )

    return client


def ensure_client_not_deleted(client: dict):
    """
    Заблокированному клиенту учётку завести можно: по принятому решению
    блокировка означает режим чтения в кабинете, а не отсутствие кабинета.
    Клиенту в корзине — нельзя: карточки фактически нет.
    """
    if client.get("is_deleted"):
        raise HTTPException(
            status_code=400,
            detail="Клиент находится в корзине. Сначала восстановите его.",
        )


def get_portal_role(cursor) -> dict:
    cursor.execute(
        """
        SELECT id, code, name, is_active
        FROM roles
        WHERE code = %s
        LIMIT 1
        """,
        (CLIENT_PORTAL_ROLE,),
    )

    role = cursor.fetchone()

    if not role:
        raise HTTPException(
            status_code=500,
            detail="Роль клиентского портала не найдена в справочнике ролей",
        )

    if not role["is_active"]:
        raise HTTPException(
            status_code=400,
            detail="Роль клиентского портала отключена в настройках",
        )

    return role


def serialize_portal_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "client_id": row["client_id"],
        "role": row["role"],
        "role_name": row.get("role_name") or row.get("role"),
        "role_badge_color": row.get("role_badge_color") or "#0F766E",
        "is_active": bool(row["is_active"]),
        "is_approved": bool(row["is_approved"]),
        "is_deleted": row.get("deleted_at") is not None,
        "is_super_admin": bool(row.get("is_super_admin")),
        "created_at": row.get("created_at"),
        "deleted_at": row.get("deleted_at"),
        "last_login_at": row.get("last_login_at"),
    }


PORTAL_USER_SELECT = """
    SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.client_id,
        u.is_active,
        u.is_approved,
        u.created_at,
        u.deleted_at,

        r.name AS role_name,
        r.badge_color AS role_badge_color,

        COALESCE(usf.is_super_admin, 0) AS is_super_admin,

        (
            SELECT MAX(a.created_at)
            FROM auth_attempts a
            WHERE a.attempt_type = 'login'
              AND a.is_success = 1
              -- users создана с utf8mb4_0900_ai_ci, auth_attempts —
              -- с utf8mb4_unicode_ci. Прямое сравнение падает с
              -- «Illegal mix of collations», поэтому приводим обе
              -- стороны явно. Charset у таблиц один (utf8mb4),
              -- так что приведение безопасно.
              AND a.email COLLATE utf8mb4_unicode_ci
                  = u.email COLLATE utf8mb4_unicode_ci
        ) AS last_login_at
    FROM users u
    LEFT JOIN roles r ON r.code = u.role
    LEFT JOIN user_security_flags usf ON usf.user_id = u.id
"""


def load_portal_user(cursor, client_id: int, user_id: int) -> dict | None:
    """
    Учётка ищется вместе с client_id из адреса. Так подмена идентификатора
    в URL не даст добраться до учётки другого клиента: несовпадение вернёт
    404, а не чужую строку.
    """
    cursor.execute(
        PORTAL_USER_SELECT
        + """
        WHERE u.id = %s
          AND u.client_id = %s
          AND u.user_kind = 'CLIENT'
        LIMIT 1
        """,
        (user_id, client_id),
    )

    return cursor.fetchone()


def require_portal_user(cursor, client_id: int, user_id: int) -> dict:
    user = load_portal_user(cursor, client_id, user_id)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Учётная запись портала не найдена",
        )

    return user


def get_client_display_name(client: dict) -> str:
    return (
        client.get("company_name")
        or client.get("name")
        or f"Клиент #{client.get('id')}"
    )


# ---------------------------------------------------------------------------
# Галочки доступов
# ---------------------------------------------------------------------------

def get_portal_permission_catalogue(cursor, role_id: int) -> list[dict]:
    """
    Все активные права портала и их место в стандарте роли.

    in_role_standard — право входит в стандарт CLIENT_PORTAL;
    is_locked        — обязательное право роли (is_locked_core), галочку
                       снять нельзя. Сейчас это portal.access и
                       portal.password.change: без первого учётка не входит,
                       без второго клиент не сможет сменить свой пароль,
                       а сбросить его иначе как через админа он не может.
    """
    cursor.execute(
        """
        SELECT
            p.id,
            p.code,
            p.name,
            p.description,
            p.sort_order,
            (rp.permission_id IS NOT NULL) AS in_role_standard,
            COALESCE(rp.is_locked_core, 0) AS is_locked
        FROM permissions p
        LEFT JOIN role_permissions rp
            ON rp.permission_id = p.id
           AND rp.role_id = %s
        WHERE p.category = %s
          AND p.is_active = 1
        ORDER BY p.sort_order ASC, p.code ASC
        """,
        (role_id, PORTAL_PERMISSION_CATEGORY),
    )

    rows = cursor.fetchall() or []

    for row in rows:
        row["in_role_standard"] = bool(row["in_role_standard"])
        row["is_locked"] = bool(row["is_locked"])

    return rows


def get_portal_user_overrides(cursor, user_id: int) -> dict[str, str]:
    """
    Индивидуальные отклонения пользователя — только по правам портала.
    Остальные категории здесь не наши: их не читаем и не трогаем.
    """
    cursor.execute(
        """
        SELECT
            p.code,
            upo.effect
        FROM user_permission_overrides upo
        INNER JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = %s
          AND p.category = %s
        """,
        (user_id, PORTAL_PERMISSION_CATEGORY),
    )

    return {
        row["code"]: str(row["effect"] or "").strip().upper()
        for row in cursor.fetchall() or []
    }


def build_portal_permission_state(
    catalogue: list[dict],
    overrides: dict[str, str],
) -> list[dict]:
    """
    Превращает «стандарт + отклонения» в набор галочек для интерфейса.
    """
    result = []

    for permission in catalogue:
        code = permission["code"]
        effect = overrides.get(code) or None
        checked = permission["in_role_standard"]

        if permission["is_locked"]:
            # Обязательное право роли: DENY на него не действует
            # (см. get_effective_permissions), поэтому и показывать
            # отклонение нечестно — галочка просто стоит.
            checked = True
            effect = None
        elif effect == PERMISSION_EFFECT_ALLOW:
            checked = True
        elif effect == PERMISSION_EFFECT_DENY:
            checked = False

        result.append(
            {
                "code": code,
                "name": permission["name"],
                "description": permission["description"],
                "sort_order": permission["sort_order"],
                "in_role_standard": permission["in_role_standard"],
                "is_locked": permission["is_locked"],
                "checked": checked,
                "override": effect,
            }
        )

    return result


def build_desired_overrides(
    catalogue: list[dict],
    checked_codes: set[str],
) -> dict[str, str]:
    """
    Обратный пересчёт: из галочек — в отклонения от стандарта.
    Совпадение со стандартом не пишется вообще, поэтому изменение
    стандарта роли автоматически доезжает до всех, кому его не меняли руками.
    """
    desired = {}

    for permission in catalogue:
        code = permission["code"]

        if permission["is_locked"]:
            continue

        is_checked = code in checked_codes

        if is_checked and not permission["in_role_standard"]:
            desired[code] = PERMISSION_EFFECT_ALLOW
        elif not is_checked and permission["in_role_standard"]:
            desired[code] = PERMISSION_EFFECT_DENY

    return desired


def ensure_portal_user_permissions_editable(user: dict):
    if user.get("deleted_at") is not None:
        raise HTTPException(
            status_code=400,
            detail="Учётная запись удалена. Сначала включите её.",
        )

    if bool(user.get("is_super_admin")):
        raise HTTPException(
            status_code=400,
            detail=(
                "У этой учётной записи стоит флаг Супер-Админа, она получает "
                "все права системы. Галочки портала на неё не влияют — "
                "снимите флаг в разделе доступов."
            ),
        )


# ---------------------------------------------------------------------------
# Эндпоинты: список и создание
# ---------------------------------------------------------------------------

@router.get("/{client_id}/portal-users")
def get_client_portal_users(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Учётные записи портала у клиента. Пароли не отдаются никогда."""
    ensure_portal_users_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            cursor.execute(
                PORTAL_USER_SELECT
                + """
                WHERE u.client_id = %s
                  AND u.user_kind = 'CLIENT'
                ORDER BY
                    u.deleted_at IS NOT NULL ASC,
                    u.is_active DESC,
                    u.name ASC
                """,
                (client_id,),
            )

            users = [serialize_portal_user(row) for row in cursor.fetchall()]

            return {
                "client_id": client["id"],
                "client_name": get_client_display_name(client),
                "client_status": client.get("status"),
                "can_manage": (
                    is_super_admin(current_user)
                    or has_any_permission(
                        current_user,
                        PORTAL_USERS_MANAGE_PERMISSION_CODES,
                    )
                ),
                "users": users,
            }

    finally:
        connection.close()


# Объявлен ДО маршрутов с {user_id}: иначе FastAPI попытается разобрать
# "permissions" как int и вернёт 422 вместо этого эндпоинта.
@router.get("/{client_id}/portal-users/permissions")
def get_portal_permissions_catalogue(
    client_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Каталог прав портала и стандарт роли — без привязки к пользователю.

    Нужен вкладке «Создать пользователя»: там видно, какие галочки получит
    новая учётка, ещё до её создания.
    """
    ensure_portal_users_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            role = get_portal_role(cursor)
            catalogue = get_portal_permission_catalogue(cursor, role["id"])

            return {
                "client_id": client_id,
                "role_code": role["code"],
                "role_name": role["name"],
                "permissions": build_portal_permission_state(catalogue, {}),
            }

    finally:
        connection.close()


@router.post("/{client_id}/portal-users")
def create_client_portal_user(
    client_id: int,
    data: PortalUserCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Создание учётной записи портала.

    Учётка создаётся сразу одобренной: одобрение придумано для
    самостоятельной регистрации сотрудников, а здесь доступ выдаёт
    сотрудник осознанно и под своим именем в журнале.
    """
    ensure_portal_users_manage(current_user)

    email = normalize_portal_email(data.email)
    name = normalize_portal_user_name(data.name)
    password = validate_portal_password(data.password)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            ensure_client_not_deleted(client)

            role = get_portal_role(cursor)

            # Сообщение намеренно без подробностей: занять email могла
            # учётка клиента, к которому у этого сотрудника доступа нет.
            cursor.execute(
                "SELECT id FROM users WHERE email = %s LIMIT 1",
                (email,),
            )

            if cursor.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Этот email уже используется в системе",
                )

            cursor.execute(
                """
                INSERT INTO users (
                    email,
                    hashed_password,
                    name,
                    city,
                    role,
                    user_kind,
                    client_id,
                    is_approved,
                    is_active
                )
                VALUES (%s, %s, %s, NULL, %s, 'CLIENT', %s, 1, 1)
                """,
                (
                    email,
                    hash_password(password),
                    name,
                    role["code"],
                    client_id,
                ),
            )

            user_id = cursor.lastrowid

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="PORTAL_USER_CREATED",
                field_name="portal_user",
                old_value=None,
                new_value=email,
                comment=f"Создана учётная запись портала: {name}",
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                target_role_id=role["id"],
                action="PORTAL_USER_CREATED",
                old_value=None,
                new_value={
                    "email": email,
                    "name": name,
                    "client_id": client_id,
                    "role": role["code"],
                },
                reason="Portal user created from client card",
            )

            connection.commit()

            created = load_portal_user(cursor, client_id, user_id)

            return serialize_portal_user(created)

    except HTTPException:
        connection.rollback()
        raise
    except IntegrityError as e:
        connection.rollback()

        if e.args and e.args[0] == 1062:
            raise HTTPException(
                status_code=409,
                detail="Этот email уже используется в системе",
            )

        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


# ---------------------------------------------------------------------------
# Эндпоинты: доступы конкретной учётки
# ---------------------------------------------------------------------------

@router.get("/{client_id}/portal-users/{user_id}/permissions")
def get_client_portal_user_permissions(
    client_id: int,
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Галочки доступов конкретной учётной записи портала."""
    ensure_portal_users_view(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            user = require_portal_user(cursor, client_id, user_id)

            role = get_portal_role(cursor)
            catalogue = get_portal_permission_catalogue(cursor, role["id"])
            overrides = get_portal_user_overrides(cursor, user_id)

            return {
                "client_id": client_id,
                "role_code": role["code"],
                "role_name": role["name"],
                "user": serialize_portal_user(user),
                "permissions": build_portal_permission_state(catalogue, overrides),
            }

    finally:
        connection.close()


@router.put("/{client_id}/portal-users/{user_id}/permissions")
def update_client_portal_user_permissions(
    client_id: int,
    user_id: int,
    data: PortalUserPermissionsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Сохранение галочек. На вход приходит список отмеченных кодов, всё
    остальное считается снятым — полная замена, а не частичное изменение.

    Работает только с категорией portal. Любой другой код будет отвергнут:
    через настройку клиента нельзя выдать внешнему человеку доступ к CRM.
    """
    ensure_portal_users_manage(current_user)

    requested_codes = normalize_permission_codes(data.permission_codes)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            user = require_portal_user(cursor, client_id, user_id)
            ensure_portal_user_permissions_editable(user)

            role = get_portal_role(cursor)
            catalogue = get_portal_permission_catalogue(cursor, role["id"])

            catalogue_by_code = {
                permission["code"]: permission for permission in catalogue
            }

            unknown_codes = sorted(requested_codes - set(catalogue_by_code.keys()))

            if unknown_codes:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Эти коды не относятся к клиентскому порталу: "
                        + ", ".join(unknown_codes)
                    ),
                )

            # Обязательные права роли включены всегда, независимо от того,
            # что прислал фронт.
            checked_codes = set(requested_codes)

            for permission in catalogue:
                if permission["is_locked"]:
                    checked_codes.add(permission["code"])

            desired_overrides = build_desired_overrides(catalogue, checked_codes)

            old_overrides = get_portal_user_overrides(cursor, user_id)
            old_state = build_portal_permission_state(catalogue, old_overrides)

            # Удаляем только портальные отклонения. Остальные категории
            # у клиентской учётки появиться не должны, но если они там
            # есть — это чужая история, и стирать её молча нельзя.
            cursor.execute(
                """
                DELETE upo
                FROM user_permission_overrides upo
                INNER JOIN permissions p ON p.id = upo.permission_id
                WHERE upo.user_id = %s
                  AND p.category = %s
                """,
                (user_id, PORTAL_PERMISSION_CATEGORY),
            )

            for code in sorted(desired_overrides.keys()):
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
                        catalogue_by_code[code]["id"],
                        desired_overrides[code],
                        data.reason,
                        current_user["id"],
                        current_user["id"],
                    ),
                )

            new_overrides = get_portal_user_overrides(cursor, user_id)
            new_state = build_portal_permission_state(catalogue, new_overrides)

            changed_codes = sorted(
                permission["code"]
                for permission, previous in zip(new_state, old_state)
                if permission["checked"] != previous["checked"]
            )

            if changed_codes:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action="PORTAL_USER_PERMISSIONS_UPDATED",
                    field_name="portal_user_permissions",
                    old_value=", ".join(
                        permission["code"]
                        for permission in old_state
                        if permission["checked"]
                    )
                    or None,
                    new_value=", ".join(
                        permission["code"]
                        for permission in new_state
                        if permission["checked"]
                    )
                    or None,
                    comment=(
                        f"Изменены доступы портала для {user['email']}: "
                        + ", ".join(changed_codes)
                    )[:500],
                )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                target_role_id=role["id"],
                action="PORTAL_USER_PERMISSIONS_UPDATED",
                old_value={
                    "checked": [
                        permission["code"]
                        for permission in old_state
                        if permission["checked"]
                    ],
                    "overrides": old_overrides,
                },
                new_value={
                    "checked": [
                        permission["code"]
                        for permission in new_state
                        if permission["checked"]
                    ],
                    "overrides": new_overrides,
                },
                reason=data.reason or "Portal user permissions updated from client card",
            )

            connection.commit()

            return {
                "client_id": client_id,
                "role_code": role["code"],
                "role_name": role["name"],
                "user": serialize_portal_user(user),
                "permissions": new_state,
                "changed_codes": changed_codes,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


# ---------------------------------------------------------------------------
# Эндпоинты: изменение учётки
# ---------------------------------------------------------------------------

@router.patch("/{client_id}/portal-users/{user_id}")
def update_client_portal_user(
    client_id: int,
    user_id: int,
    data: PortalUserUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Имя и включение/отключение учётки.

    Email не меняется: он же логин, и смена логина у действующей учётки —
    это фактически другой пользователь. Нужен другой адрес — заводится
    новая учётка, старая отключается, в журнале остаются обе.
    """
    ensure_portal_users_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            client = ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            user = require_portal_user(cursor, client_id, user_id)

            updates = []
            values = []

            new_values = {}
            old_values = {}

            if data.name is not None:
                name = normalize_portal_user_name(data.name)

                if name != user["name"]:
                    updates.append("name = %s")
                    values.append(name)

                    old_values["name"] = user["name"]
                    new_values["name"] = name

            if data.is_active is not None:
                is_active = bool(data.is_active)
                was_active = bool(user["is_active"]) and user["deleted_at"] is None

                if is_active != was_active:
                    if is_active:
                        ensure_client_not_deleted(client)

                        # Включение возвращает и из «удалённых»: иначе
                        # отключённая и удалённая учётки вели бы себя
                        # по-разному при одном действии в интерфейсе.
                        updates.append("is_active = 1")
                        updates.append("deleted_at = NULL")
                        updates.append("deleted_by = NULL")
                    else:
                        updates.append("is_active = 0")

                    old_values["is_active"] = was_active
                    new_values["is_active"] = is_active

            if not updates:
                return serialize_portal_user(user)

            values.append(user_id)

            cursor.execute(
                f"""
                UPDATE users
                SET {', '.join(updates)}
                WHERE id = %s
                """,
                tuple(values),
            )

            if "is_active" in new_values:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action=(
                        "PORTAL_USER_ENABLED"
                        if new_values["is_active"]
                        else "PORTAL_USER_DISABLED"
                    ),
                    field_name="portal_user",
                    old_value=user["email"],
                    new_value=user["email"],
                    comment=(
                        "Учётная запись портала включена"
                        if new_values["is_active"]
                        else "Учётная запись портала отключена"
                    ),
                )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="PORTAL_USER_UPDATED",
                old_value=old_values,
                new_value=new_values,
                reason=data.reason or "Portal user updated from client card",
            )

            connection.commit()

            updated = load_portal_user(cursor, client_id, user_id)

            return serialize_portal_user(updated)

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.post("/{client_id}/portal-users/{user_id}/password")
def set_client_portal_user_password(
    client_id: int,
    user_id: int,
    data: PortalUserPasswordSet,
    current_user: dict = Depends(get_current_user),
):
    """
    Новый пароль учётной записи портала — так же, как сотруднику
    в admin.py: администратор задаёт пароль, старый не спрашивается.

    Сам пароль в журнал не пишется, только факт смены.
    """
    ensure_portal_users_manage(current_user)

    password = validate_portal_password(data.password)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            user = require_portal_user(cursor, client_id, user_id)

            if user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Учётная запись удалена. Сначала включите её.",
                )

            # Ради этого случая счётчик и заводился: сброс пароля
            # скомпрометированной учётке должен закрывать чужую сессию
            # сразу, а не через восемь часов.
            cursor.execute(
                """
                UPDATE users
                SET hashed_password = %s,
                    token_version = token_version + 1
                WHERE id = %s
                """,
                (hash_password(password), user_id),
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="PORTAL_USER_PASSWORD_SET",
                field_name="portal_user",
                old_value=user["email"],
                new_value=user["email"],
                comment="Задан новый пароль учётной записи портала",
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="PORTAL_USER_PASSWORD_SET",
                old_value=None,
                new_value={"email": user["email"], "password_changed": True},
                reason=data.reason or "Portal user password set from client card",
            )

            connection.commit()

            return {"message": "Пароль обновлён"}

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()


@router.delete("/{client_id}/portal-users/{user_id}")
def delete_client_portal_user(
    client_id: int,
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Мягкое удаление: строка остаётся, вход закрывается.

    Физически удалять нельзя — на users ссылаются журналы и, возможно,
    заявки, созданные из кабинета. Email при этом остаётся занятым:
    учётку можно вернуть включением, а не заводить дубликат.
    """
    ensure_portal_users_manage(current_user)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            ensure_client_access(
                load_client_for_portal_users(cursor, client_id),
                current_user,
            )

            user = require_portal_user(cursor, client_id, user_id)

            if user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Учётная запись уже удалена",
                )

            cursor.execute(
                """
                UPDATE users
                SET is_active = 0,
                    deleted_at = NOW(),
                    deleted_by = %s
                WHERE id = %s
                """,
                (current_user["id"], user_id),
            )

            add_client_history(
                cursor,
                client_id=client_id,
                user_id=current_user["id"],
                action="PORTAL_USER_DELETED",
                field_name="portal_user",
                old_value=user["email"],
                new_value=None,
                comment=f"Удалена учётная запись портала: {user['name']}",
            )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=user_id,
                action="PORTAL_USER_DELETED",
                old_value={
                    "email": user["email"],
                    "name": user["name"],
                    "client_id": client_id,
                    "is_active": bool(user["is_active"]),
                },
                new_value={"is_active": False, "deleted": True},
                reason="Portal user deleted from client card",
            )

            connection.commit()

            return {"message": "Учётная запись портала удалена"}

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()