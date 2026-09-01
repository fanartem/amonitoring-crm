from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import (
    verify_password,
    create_access_token,
    hash_password,
    get_current_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)
from app.permissions import (
    ADMIN,
    attach_effective_permissions,
    get_user_base_access,
)
from app.schemas import UserCreate
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
                    is_approved
                )
                VALUES (%s, %s, %s, %s, %s, %s)
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

            attach_effective_permissions(cursor, user)

            record_auth_attempt(cursor, "login", email, client_ip, True, None)
            connection.commit()

            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

            # В токене только идентификатор. Роль, город и права всегда берутся
            # из БД в get_current_user, чтобы изменения в Settings действовали
            # немедленно, а не после перелогина.
            access_token = create_access_token(
                data={"sub": str(user["id"])},
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
    """
    return {
        "id": current_user["id"],
        "name": current_user["name"],
        "email": current_user["email"],
        "role": current_user["role"],
        "role_name": current_user["role_name"],
        "role_badge_color": current_user["role_badge_color"],
        "data_scope": current_user["data_scope"],
        "city": current_user["city"],
        "is_super_admin": current_user["is_super_admin"],
        "is_owner": current_user["is_owner"],
        "permissions": current_user["permissions"],
        "locked_core_permissions": current_user["locked_core_permissions"],
        "can_be_request_executor": current_user["can_be_request_executor"],
        "can_be_responsible_manager": current_user["can_be_responsible_manager"],
    }