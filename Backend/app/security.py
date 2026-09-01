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

            attach_effective_permissions(cursor, user)

            return user

    finally:
        connection.close()
