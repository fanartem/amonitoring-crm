from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import (
    verify_password,
    create_access_token,
    hash_password,
    get_current_user,
    get_user_token_version,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    TOKEN_VERSION_CLAIM,
)
from app.permissions import (
    ADMIN,
    add_access_audit_log,
    add_client_history,
    attach_effective_permissions,
    can_change_own_portal_password,
    client_account_is_deleted,
    get_portal_access_state,
    get_user_base_access,
    get_user_client_id,
    is_client_user,
)
from app.schemas import PortalPasswordChange, UserCreate
from datetime import timedelta
from pymysql.err import IntegrityError

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Ограничение частоты. Счётчик по email защищает конкретный аккаунт от
# перебора пароля, счётчик по IP — систему от перебора по списку адресов.
LOGIN_FAIL_WINDOW_MINUTES = 15
LOGIN_MAX_FAILS_PER_EMAIL = 10
LOGIN_MAX_FAILS_PER_IP = 30
REGISTER_WINDOW_MINUTES = 60
REGISTER_MAX_PER_IP = 5


def get_client_ip(request: Request) -> str | None:
    """
    За nginx реальный адрес приходит в X-Forwarded-For. Заголовок подделывается
    клиентом, поэтому на нём держится только счётчик по IP — счётчик по email
    подделать нельзя, и именно он защищает конкретный аккаунт.
    """
    forwarded = request.headers.get("x-forwarded-for")

    if forwarded:
        return forwarded.split(",")[0].strip()[:45]

    if request.client:
        return str(request.client.host)[:45]

    return None


def record_auth_attempt(
    cursor,
    attempt_type: str,
    email: str | None,
    client_ip: str | None,
    is_success: bool,
    failure_reason: str | None = None,
):
    cursor.execute(
        """
        INSERT INTO auth_attempts (
            attempt_type,
            email,
            ip_address,
            is_success,
            failure_reason
        )
        VALUES (%s, %s, %s, %s, %s)
        """,
        (
            attempt_type,
            (email or "")[:255] or None,
            client_ip,
            1 if is_success else 0,
            failure_reason,
        ),
    )


def ensure_login_not_blocked(cursor, email: str, client_ip: str | None):
    """
    Считаются только неудачи после последнего успешного входа: успешный вход
    обнуляет счётчик, иначе сотрудник, трижды опечатавшийся утром, весь день
    ходит у самой границы блокировки.

    Заблокированная попытка в журнал не пишется — иначе бот продлевал бы
    блокировку живому пользователю бесконечно.
    """
    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM auth_attempts
        WHERE attempt_type = 'login'
          AND email = %s
          AND is_success = 0
          AND created_at > DATE_SUB(NOW(), INTERVAL %s MINUTE)
          AND id > COALESCE((
              SELECT MAX(s.id)
              FROM auth_attempts s
              WHERE s.attempt_type = 'login'
                AND s.email = %s
                AND s.is_success = 1
          ), 0)
        """,
        (email[:255], LOGIN_FAIL_WINDOW_MINUTES, email[:255]),
    )

    if cursor.fetchone()["count"] >= LOGIN_MAX_FAILS_PER_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много неудачных попыток входа. "
                f"Повторите через {LOGIN_FAIL_WINDOW_MINUTES} минут."
            ),
        )

    if not client_ip:
        return

    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM auth_attempts
        WHERE attempt_type = 'login'
          AND ip_address = %s
          AND is_success = 0
          AND created_at > DATE_SUB(NOW(), INTERVAL %s MINUTE)
        """,
        (client_ip, LOGIN_FAIL_WINDOW_MINUTES),
    )

    if cursor.fetchone()["count"] >= LOGIN_MAX_FAILS_PER_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Слишком много неудачных попыток входа. "
                f"Повторите через {LOGIN_FAIL_WINDOW_MINUTES} минут."
            ),
        )


def ensure_registration_not_blocked(cursor, client_ip: str | None):
    if not client_ip:
        return

    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM auth_attempts
        WHERE attempt_type = 'register'
          AND ip_address = %s
          AND created_at > DATE_SUB(NOW(), INTERVAL %s MINUTE)
        """,
        (client_ip, REGISTER_WINDOW_MINUTES),
    )

    if cursor.fetchone()["count"] >= REGISTER_MAX_PER_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много заявок на регистрацию. Попробуйте позже.",
        )


def validate_registration_role(cursor, role_code: str) -> dict:
    normalized_role = str(role_code or "").strip().upper()

    if not normalized_role:
        raise HTTPException(status_code=400, detail="Необходимо выбрать роль")

    cursor.execute(
        """
        SELECT
            id,
            code,
            name,
            is_active,
            can_be_request_executor,
            can_self_register
        FROM roles
        WHERE code = %s
        LIMIT 1
        """,
        (normalized_role,),
    )

    role = cursor.fetchone()

    if not role:
        raise HTTPException(status_code=400, detail="Некорректная роль")

    if not role["is_active"]:
        raise HTTPException(status_code=400, detail="Выбранная роль отключена")

    if not role.get("can_self_register"):
        raise HTTPException(
            status_code=400,
            detail="Эту роль нельзя выбрать при самостоятельной регистрации",
        )

    # Симметрично GET /auth/registration-roles: роль администратора
    # недоступна для самостоятельной регистрации, даже если галочку
    # can_self_register поставили ей в Settings по ошибке.
    if role["code"] == ADMIN:
        raise HTTPException(
            status_code=400,
            detail="Эту роль нельзя выбрать при самостоятельной регистрации",
        )

    return role

def resolve_registration_city(cursor, role: dict, city_value) -> str | None:
    """
    Город хранится только для ролей-исполнителей и только из справочника cities.
    Для остальных ролей город игнорируется, даже если фронт его прислал.
    """
    if not role.get("can_be_request_executor"):
        return None

    if not city_value:
        raise HTTPException(
            status_code=400,
            detail="Для этой роли необходимо указать город",
        )

    normalized_city = str(city_value).strip()

    cursor.execute(
        """
        SELECT name
        FROM cities
        WHERE name = %s
          AND is_active = 1
        LIMIT 1
        """,
        (normalized_city,),
    )

    city_row = cursor.fetchone()

    if not city_row:
        raise HTTPException(
            status_code=400,
            detail="Указан несуществующий или отключённый город",
        )

    return city_row["name"]

@router.get("/registration-roles")
def get_registration_roles():
    """
    Публичный список ролей для формы регистрации.

    Важно:
    - endpoint без авторизации;
    - ADMIN не показываем в регистрации;
    - роли берутся из таблицы roles, а не из frontend hardcode;
    - city required на frontend определяется по can_be_request_executor.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    code,
                    name,
                    badge_color,
                    can_be_request_executor,
                    can_be_responsible_manager,
                    sort_order
                FROM roles
                WHERE is_active = 1
                  AND can_self_register = 1
                  AND code <> %s
                ORDER BY sort_order ASC, name ASC
                """,
                (ADMIN,),
            )

            roles = cursor.fetchall()

            for role in roles:
                role["can_be_request_executor"] = bool(
                    role.get("can_be_request_executor")
                )
                role["can_be_responsible_manager"] = bool(
                    role.get("can_be_responsible_manager")
                )

            return roles
    finally:
        connection.close()

@router.post("/register")
def register(data: UserCreate, request: Request):
    connection = get_connection()

    email = data.email.strip().lower()
    name = data.name.strip()
    client_ip = get_client_ip(request)

    if not name:
        raise HTTPException(status_code=400, detail="Необходимо указать имя")

    try:
        with connection.cursor() as cursor:
            ensure_registration_not_blocked(cursor, client_ip)

            cursor.execute(
                "SELECT id FROM users WHERE email = %s LIMIT 1",
                (email,),
            )

            if cursor.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Пользователь с таким email уже зарегистрирован",
                )

            # FOR UPDATE: на пустой таблице InnoDB берёт gap-lock, поэтому два
            # одновременных запроса не смогут оба получить count = 0 и оба
            # стать владельцами системы.
            cursor.execute("SELECT COUNT(*) as count FROM users FOR UPDATE")
            user_count = cursor.fetchone()["count"]

            final_city = None

            if user_count == 0:
                cursor.execute(
                    """
                    SELECT
                        id,
                        code,
                        name,
                        is_active,
                        can_be_request_executor
                    FROM roles
                    WHERE code = %s
                    LIMIT 1
                    """,
                    (ADMIN,),
                )

                admin_role = cursor.fetchone()

                if not admin_role:
                    raise HTTPException(
                        status_code=500,
                        detail="Роль администратора не найдена в справочнике ролей",
                    )

                final_role = admin_role["code"]
                is_approved = True
                is_first_owner = True
                final_city = resolve_registration_city(cursor, admin_role, data.city)
            else:
                role = validate_registration_role(cursor, data.role)
                final_role = role["code"]
                is_approved = False
                is_first_owner = False
                final_city = resolve_registration_city(cursor, role, data.city)

            hashed = hash_password(data.password)

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
                    is_approved
                )
                VALUES (%s, %s, %s, %s, %s, 'EMPLOYEE', NULL, %s)
                """,
                (
                    email,
                    hashed,
                    name,
                    final_city,
                    final_role,
                    is_approved,
                ),
            )

            user_id = cursor.lastrowid

            cursor.execute(
                """
                INSERT INTO user_security_flags (
                    user_id,
                    is_super_admin,
                    is_owner,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, NOW(), NOW())
                """,
                (
                    user_id,
                    1 if is_first_owner else 0,
                    1 if is_first_owner else 0,
                ),
            )

            record_auth_attempt(cursor, "register", email, client_ip, True, None)

            connection.commit()

            if is_approved:
                return {
                    "message": "You are the first user! Admin account created and approved automatically."
                }

            return {
                "message": "Registration request sent. Wait for admin approval."
            }

    except HTTPException:
        connection.rollback()

        # Отклонённые заявки тоже идут в счётчик, иначе перебор ролей и email
        # проходит мимо ограничения.
        try:
            with connection.cursor() as cursor:
                record_auth_attempt(cursor, "register", email, client_ip, False, "rejected")

            connection.commit()
        except Exception:
            connection.rollback()

        raise

    except IntegrityError as e:
        connection.rollback()

        if e.args and e.args[0] == 1062:
            raise HTTPException(
                status_code=409,
                detail="Пользователь с таким email уже зарегистрирован",
            )

        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        connection.close()
        
@router.post("/login")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    connection = get_connection()

    email = form_data.username.strip().lower()
    client_ip = get_client_ip(request)

    def deny(cursor, status_code: int, detail: str, reason: str) -> HTTPException:
        """Пишет неудачную попытку в журнал и возвращает исключение для raise."""
        record_auth_attempt(cursor, "login", email, client_ip, False, reason)
        connection.commit()
        return HTTPException(status_code=status_code, detail=detail)

    try:
        with connection.cursor() as cursor:
            ensure_login_not_blocked(cursor, email, client_ip)

            cursor.execute(
                """
                SELECT
                    id,
                    hashed_password
                FROM users
                WHERE email = %s
                LIMIT 1
                """,
                (email,),
            )
            auth_user = cursor.fetchone()

            if not auth_user or not verify_password(
                form_data.password,
                auth_user["hashed_password"],
            ):
                raise deny(
                    cursor,
                    status.HTTP_401_UNAUTHORIZED,
                    "Неправильный email или пароль",
                    "bad_credentials",
                )

            user = get_user_base_access(cursor, int(auth_user["id"]))

            if not user:
                raise deny(
                    cursor,
                    status.HTTP_401_UNAUTHORIZED,
                    "Неправильный email или пароль",
                    "no_access_row",
                )

            if not user.get("is_active") or user.get("deleted_at") is not None:
                raise deny(
                    cursor,
                    status.HTTP_403_FORBIDDEN,
                    "Ваш аккаунт отключен администратором.",
                    "inactive",
                )

            if not user["is_approved"]:
                raise deny(
                    cursor,
                    status.HTTP_403_FORBIDDEN,
                    "Ваш аккаунт все еще не одобрен администратором. Пожалуйста, подождите.",
                    "not_approved",
                )

            if not user.get("role_code"):
                raise deny(
                    cursor,
                    status.HTTP_403_FORBIDDEN,
                    "Роль пользователя не найдена в системе доступов.",
                    "no_role",
                )

            if not user.get("role_is_active"):
                raise deny(
                    cursor,
                    status.HTTP_403_FORBIDDEN,
                    "Ваша роль отключена.",
                    "role_disabled",
                )

            # Клиентская учётка: состояние клиента решает, пускать ли вообще.
            # Текст один и тот же для обоих случаев и без подробностей —
            # на странице входа мы ещё не знаем, кто по ту сторону, и статус
            # клиента ему не сообщаем. Разница видна только в журнале.
            if is_client_user(user):
                if not get_user_client_id(user):
                    raise deny(
                        cursor,
                        status.HTTP_403_FORBIDDEN,
                        "Доступ в личный кабинет закрыт. Обратитесь к вашему менеджеру.",
                        "client_not_linked",
                    )

                if client_account_is_deleted(user):
                    raise deny(
                        cursor,
                        status.HTTP_403_FORBIDDEN,
                        "Доступ в личный кабинет закрыт. Обратитесь к вашему менеджеру.",
                        "client_deleted",
                    )

            # Рекурсивный обход ветки. Здесь он уместен: вход происходит
            # редко, а знать режим кабинета нужно сразу.
            portal_state = get_portal_access_state(cursor, user)

            attach_effective_permissions(cursor, user)

            record_auth_attempt(cursor, "login", email, client_ip, True, None)
            connection.commit()

            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

            # В токене идентификатор и версия токенов. Роль, город и права
            # всегда берутся из БД в get_current_user, чтобы изменения
            # в Settings действовали немедленно, а не после перелогина.
            # Версия решает обратную задачу: погасить токены, выданные
            # до смены пароля, не дожидаясь истечения срока.
            access_token = create_access_token(
                data={
                    "sub": str(user["id"]),
                    TOKEN_VERSION_CLAIM: get_user_token_version(
                        cursor,
                        int(user["id"]),
                    ),
                },
                expires_delta=access_token_expires,
            )

            return {
                "access_token": access_token,
                "token_type": "bearer",
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "email": user["email"],
                    "role": user["role"],
                    "role_name": user["role_name"],
                    "role_badge_color": user["role_badge_color"],
                    "data_scope": user["data_scope"],

                    # Тип учётки нужен фронту, чтобы не показывать клиенту
                    # служебные элементы (например галочку «внутренний файл»).
                    # .get с запасным значением: если поле почему-то не пришло,
                    # считаем сотрудником не по умолчанию, а осознанно —
                    # ошибка тогда будет видна в интерфейсе сотрудника,
                    # а не утечкой в кабинете клиента.
                    "user_kind": user.get("user_kind") or "EMPLOYEE",
                    "client_id": user.get("client_id"),
                    "client_name": user.get("client_display_name"),

                    "portal_read_only": portal_state["portal_read_only"],
                    "portal_blocked_by_parent": portal_state[
                        "portal_blocked_by_parent"
                    ],

                    "city": user["city"],
                    "is_super_admin": user["is_super_admin"],
                    "is_owner": user["is_owner"],
                    "permissions": user["permissions"],
                    "locked_core_permissions": user["locked_core_permissions"],
                    "can_be_request_executor": user["can_be_request_executor"],
                    "can_be_responsible_manager": user["can_be_responsible_manager"],
                },
            }

    finally:
        connection.close()

@router.get("/me")
def read_current_user(current_user: dict = Depends(get_current_user)):
    """
    Актуальный снимок прав пользователя.

    Нужен потому, что /auth/login отдаёт права один раз, а токен живёт часами:
    без этого эндпоинта снятое в Settings право продолжает действовать на
    фронте до перелогина. Набор полей совпадает с блоком "user" в /auth/login.

    Состояние кабинета считается здесь, а не в get_current_user: запрос
    рекурсивный, и гонять его на каждый вызов API незачем. Этот эндпоинт
    фронт дёргает при загрузке страницы — этого достаточно, чтобы снятие
    блокировки доходило до клиента без перелогина.
    """
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            portal_state = get_portal_access_state(cursor, current_user)
    finally:
        connection.close()

    return {
        "id": current_user["id"],
        "name": current_user["name"],
        "email": current_user["email"],
        "role": current_user["role"],
        "role_name": current_user["role_name"],
        "role_badge_color": current_user["role_badge_color"],
        "data_scope": current_user["data_scope"],

        "user_kind": current_user.get("user_kind") or "EMPLOYEE",
        "client_id": current_user.get("client_id"),
        "client_name": current_user.get("client_display_name"),

        "portal_read_only": portal_state["portal_read_only"],
        "portal_blocked_by_parent": portal_state["portal_blocked_by_parent"],

        "city": current_user["city"],
        "is_super_admin": current_user["is_super_admin"],
        "is_owner": current_user["is_owner"],
        "permissions": current_user["permissions"],
        "locked_core_permissions": current_user["locked_core_permissions"],
        "can_be_request_executor": current_user["can_be_request_executor"],
        "can_be_responsible_manager": current_user["can_be_responsible_manager"],
    }

# Требования к паролю те же, что в portal_users.py, где пароль задаёт админ.
# Значения продублированы намеренно: роутер не должен импортировать роутер.
MIN_OWN_PASSWORD_LENGTH = 8
MAX_OWN_PASSWORD_LENGTH = 128


def validate_own_password(value) -> str:
    password = str(value or "")

    if len(password) < MIN_OWN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Пароль должен быть не короче {MIN_OWN_PASSWORD_LENGTH} символов",
        )

    if len(password) > MAX_OWN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Пароль должен быть не длиннее {MAX_OWN_PASSWORD_LENGTH} символов",
        )

    if password.strip() != password:
        raise HTTPException(
            status_code=400,
            detail="Пароль не должен начинаться или заканчиваться пробелом",
        )

    return password


@router.post("/password/change")
def change_own_password(
    data: PortalPasswordChange,
    current_user: dict = Depends(get_current_user),
):
    """
    Смена собственного пароля учётной записью клиентского портала.

    Почему только портал: по решению Р13 сотрудники продолжают менять
    пароль через PUT /admin/users/{id}, где текущий пароль не спрашивается.
    Открыть этот эндпоинт и им — правка в одну строку, но это отдельное
    решение и отдельная правка фронта, а не побочный эффект этого шага.

    Сброс пароля клиенту делает администратор в карточке клиента.
    Почты у клиентов может не быть, поэтому самостоятельного
    восстановления по email здесь нет и не планируется.
    """
    if not is_client_user(current_user):
        raise HTTPException(
            status_code=403,
            detail=(
                "Этот способ смены пароля предназначен для клиентского "
                "портала. Сотрудники меняют пароль в разделе «Настройки»."
            ),
        )

    if not can_change_own_portal_password(current_user):
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для смены пароля",
        )

    new_password = validate_own_password(data.new_password)

    if str(data.current_password or "") == new_password:
        raise HTTPException(
            status_code=400,
            detail="Новый пароль совпадает с текущим",
        )

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT hashed_password FROM users WHERE id = %s LIMIT 1",
                (current_user["id"],),
            )

            row = cursor.fetchone()

            if not row or not verify_password(
                str(data.current_password or ""),
                row["hashed_password"],
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Текущий пароль указан неверно",
                )

            # token_version + 1 гасит все выданные токены, включая токен
            # этой же вкладки. Сессию, начатую до смены пароля, продолжать
            # нельзя: именно её и могли увести — ради этого пароль и меняют.
            cursor.execute(
                """
                UPDATE users
                SET hashed_password = %s,
                    token_version = token_version + 1
                WHERE id = %s
                """,
                (hash_password(new_password), current_user["id"]),
            )

            client_id = get_user_client_id(current_user)

            # Менеджер должен видеть это в карточке клиента: смена пароля
            # клиентом — обычное событие, но при разборе «кто и когда потерял
            # доступ» без неё картина неполная.
            if client_id:
                add_client_history(
                    cursor,
                    client_id=client_id,
                    user_id=current_user["id"],
                    action="PORTAL_PASSWORD_CHANGED",
                    field_name="portal_user",
                    old_value=current_user.get("email"),
                    new_value=current_user.get("email"),
                    comment="Пользователь портала сменил свой пароль",
                )

            add_access_audit_log(
                cursor,
                actor_user_id=current_user["id"],
                target_user_id=current_user["id"],
                action="PORTAL_PASSWORD_CHANGED",
                old_value=None,
                new_value={
                    "email": current_user.get("email"),
                    "password_changed": True,
                },
                reason="Password changed by portal user",
            )

            connection.commit()

            return {
                "message": "Пароль изменён",
                "reauth_required": True,
            }

    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()