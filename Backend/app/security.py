from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from typing import Optional
from app.database import get_connection

# Настройки (в будущем вынесем в .env файл)
SECRET_KEY = "PKJDapwoodkAPWDK" # Смени на случайную строку
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480 # 8 часов

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
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)):
    """Проверяет токен и возвращает данные текущего пользователя"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Декодируем токен
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        user_role: str = payload.get("role")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Проверяем в базе, не заблокирован ли он и существует ли
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, email, name, role, is_approved FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()
            
            if user is None:
                raise credentials_exception
            if not user["is_approved"]:
                raise HTTPException(status_code=403, detail="User not approved")
            
            return user # Возвращаем инфо о юзере (id, role и т.д.)
    finally:
        connection.close()

# Специальная проверка для Админов
def get_current_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Only admins can do this")
    return current_user