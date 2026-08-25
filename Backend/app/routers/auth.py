from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import (
    verify_password,
    create_access_token,
    hash_password,
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
            can_be_request_executor
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

    return role

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
def register(data: UserCreate):
    connection = get_connection()

    email = data.email.strip().lower()
    name = data.name.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Необходимо указать имя")

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE email = %s LIMIT 1",
                (email,),
            )

            if cursor.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Пользователь с таким email уже зарегистрирован",
                )

            cursor.execute("SELECT COUNT(*) as count FROM users")
            user_count = cursor.fetchone()["count"]

            if user_count == 0:
                final_role = ADMIN
                is_approved = True
                is_first_owner = True
            else:
                role = validate_registration_role(cursor, data.role)
                final_role = role["code"]
                is_approved = False
                is_first_owner = False

                if role.get("can_be_request_executor") and not data.city:
                    raise HTTPException(
                        status_code=400,
                        detail="Для этой роли необходимо указать город",
                    )

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
                    data.city,
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
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    connection = get_connection()

    email = form_data.username.strip().lower()

    try:
        with connection.cursor() as cursor:
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
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Неправильный email или пароль",
                )

            user = get_user_base_access(cursor, int(auth_user["id"]))

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Неправильный email или пароль",
                )

            if user.get("is_active") == 0 or user.get("deleted_at") is not None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ваш аккаунт отключен администратором.",
                )

            if not user["is_approved"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ваш аккаунт все еще не одобрен администратором. Пожалуйста, подождите.",
                )

            if not user.get("role_code"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Роль пользователя не найдена в системе доступов.",
                )

            if user.get("role_is_active") == 0:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ваша роль отключена.",
                )

            attach_effective_permissions(cursor, user)

            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

            # role/city оставляем в токене только для обратной совместимости.
            # Backend им больше не доверяет: get_current_user берёт актуальные данные из БД.
            access_token = create_access_token(
                data={
                    "sub": str(user["id"]),
                    "role": user["role"],
                    "city": user["city"],
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