from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import verify_password, create_access_token, hash_password, ACCESS_TOKEN_EXPIRE_MINUTES
from app.schemas import UserCreate # Эту схему добавим в Шаге 4
from datetime import timedelta

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register")
def register(data: UserCreate):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Проверяем, не занят ли email
            cursor.execute("SELECT id FROM users WHERE email = %s", (data.email,))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Email already registered")

            # Проверяем, есть ли уже пользователи в базе
            cursor.execute("SELECT COUNT(*) as count FROM users")
            user_count = cursor.fetchone()["count"]

            # Если база пустая, первый юзер становится Админом и сразу одобряется
            if user_count == 0:
                final_role = "ADMIN"
                is_approved = True
            else:
                final_role = data.role # или роль по умолчанию, например "TECHNICIAN"
                is_approved = False

            # Хэшируем пароль и сохраняем
            hashed = hash_password(data.password)
            sql = """
            INSERT INTO users (email, hashed_password, name, city, role, is_approved)
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (data.email, hashed, data.name, data.city, final_role, is_approved))
            connection.commit()
            
            if is_approved:
                return {"message": "You are the first user! Admin account created and approved automatically."}
            else:
                return {"message": "Registration request sent. Wait for admin approval."}
    finally:
        connection.close()
        
@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # Ищем пользователя
            cursor.execute("SELECT * FROM users WHERE email = %s", (form_data.username,))
            user = cursor.fetchone()

            if not user or not verify_password(form_data.password, user["hashed_password"]):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Неправильный email или пароль",
                )

            # Проверяем одобрение админом
            if not user["is_approved"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ваш аккаунт все еще не одобрен администратором. Пожалуйста, подождите."
                )

            # Создаем токен (записываем туда ID и Роль)
            access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
            
            access_token = create_access_token(
                data={
                    "sub": str(user["id"]),
                    "role": user["role"],
                    "city": user["city"]
                },
                expires_delta=access_token_expires
            )
            
            return {
                "access_token": access_token, 
                "token_type": "bearer",
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "role": user["role"],
                    "city": user["city"]
                }
            }
    finally:
        connection.close()