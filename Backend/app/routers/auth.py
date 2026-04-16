from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import verify_password, create_access_token, hash_password
from app.schemas import UserCreate # Эту схему добавим в Шаге 4

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

            # Хэшируем пароль и сохраняем
            hashed = hash_password(data.password)
            sql = """
            INSERT INTO users (email, hashed_password, name, role, is_approved)
            VALUES (%s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (data.email, hashed, data.name, data.role, False))
            connection.commit()
            
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
                    detail="Incorrect email or password"
                )

            # Проверяем одобрение админом
            if not user["is_approved"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account not approved by admin yet"
                )

            # Создаем токен (записываем туда ID и Роль)
            access_token = create_access_token(
                data={"sub": str(user["id"]), "role": user["role"]}
            )
            
            return {
                "access_token": access_token, 
                "token_type": "bearer",
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "role": user["role"]
                }
            }
    finally:
        connection.close()