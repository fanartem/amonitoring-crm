from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from app.database import get_connection
from app.security import verify_password, create_access_token, hash_password, ACCESS_TOKEN_EXPIRE_MINUTES
from app.schemas import UserCreate
from datetime import timedelta
from pymysql.err import IntegrityError

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register")
def register(data: UserCreate):
    connection = get_connection()

    email = data.email.strip().lower()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE email = %s LIMIT 1",
                (email,)
            )

            if cursor.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail="Пользователь с таким email уже зарегистрирован"
                )

            cursor.execute("SELECT COUNT(*) as count FROM users")
            user_count = cursor.fetchone()["count"]

            if user_count == 0:
                final_role = "ADMIN"
                is_approved = True
            else:
                final_role = data.role
                is_approved = False

            hashed = hash_password(data.password)

            sql = """
            INSERT INTO users (email, hashed_password, name, city, role, is_approved)
            VALUES (%s, %s, %s, %s, %s, %s)
            """

            cursor.execute(
                sql,
                (email, hashed, data.name, data.city, final_role, is_approved)
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
                detail="Пользователь с таким email уже зарегистрирован"
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
            
            if user.get("is_active") == 0:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ваш аккаунт отключен администратором."
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