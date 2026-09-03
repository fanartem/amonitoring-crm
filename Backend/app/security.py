import os
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from typing import Optional
from dotenv import load_dotenv

from app.database import get_connection

from app.permissions import (
    attach_effective_permissions,
    ensure_client_account_can_login,
    get_user_base_access,
)

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480")
)

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set in .env")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Отзыв выданных токенов.
#
# Роль, город и права в токен не кладутся и берутся из БД на каждом
# запросе, поэтому изменения в Settings действуют сразу. Со сменой
# пароля так не выходит: пароля в токене нет, и отличить токен,
# выданный до смены, нечем. Отсюда счётчик версии на пользователе.
TOKEN_VERSION_CLAIM = "tv"


def get_user_token_version(cursor, user_id: int) -> int:
    """
    Текущая версия токенов пользователя.

    Отдельный запрос, а не поле из get_user_base_access: это индексный
    поиск по первичному ключу рядом с уже идущими запросами прав,
    а зависимость от того, какие колонки выбирает permissions.py,
    здесь была бы лишней. Понадобится — перенесём в общий SELECT.
    """
    cursor.execute(
        "SELECT token_version FROM users WHERE id = %s LIMIT 1",
        (user_id,),
    )

    row = cursor.fetchone()

    if not row:
        return 0

    return int(row.get("token_version") or 0)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])

        # Токены, выданные до этой правки, поля версии не содержат.
        # Читаем их как 0 — столько же стоит в колонке по умолчанию,
        # поэтому выкатка никого не разлогинивает.
        token_version = int(payload.get(TOKEN_VERSION_CLAIM) or 0)

    except (JWTError, KeyError, TypeError, ValueError):
        raise credentials_exception

    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            user = get_user_base_access(cursor, user_id)

            if user is None:
                raise credentials_exception

            if not user["is_approved"]:
                raise HTTPException(status_code=403, detail="User not approved")

            if not user.get("is_active") or user.get("deleted_at") is not None:
                raise credentials_exception

            if not user.get("role_code"):
                raise HTTPException(
                    status_code=403,
                    detail="Роль пользователя не найдена в системе доступов"
                )

            if not user.get("role_is_active"):
                raise HTTPException(
                    status_code=403,
                    detail="Роль пользователя отключена"
                )

            # Клиент удалён или учётка потеряла привязку — доступ закрыт
            # сразу, на любом эндпоинте. Проверка дешёвая: только поля
            # уже загруженной строки. Блокировка сюда не входит намеренно,
            # она означает режим чтения, а не отказ во входе.
            ensure_client_account_can_login(user)

            # Пароль сменили — значит все токены, выданные раньше,
            # больше не годятся. Проверяем до сбора прав: незачем
            # собирать права для токена, который сейчас отвергнем.
            if token_version != get_user_token_version(cursor, user_id):
                raise credentials_exception

            attach_effective_permissions(cursor, user)

            return user

    finally:
        connection.close()
