Репозиторий: https://github.com/fanartem/amonitoring-crm

Ниже инструкция по разворачиванию на сервере.

Стек проекта:

Frontend: React + Vite
Backend: Python FastAPI
Database: внешний Yandex Managed MySQL
Reverse proxy: nginx
Backend-запуск: Docker Compose

Ожидаемая production-схема:

https://crm.amonitoring.kz → React frontend
https://crm.amonitoring.kz/api → FastAPI backend через nginx reverse proxy
MySQL → внешний Yandex Managed MySQL cluster

---

1. Структура проекта на сервере

Предлагаемая структура:

amonitoring-crm/
├── Backend/
│   ├── app/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env
│   └── ...
├── Frontend/
│   ├── dist/
│   └── ...
├── certs/
│   └── root.crt
├── uploads/
└── docker-compose.yml

Папка `uploads` нужна для хранения прикреплённых файлов к клиентам и заявкам. Её важно не удалять при пересборке контейнера.

Папка `certs` нужна для SSL-сертификата подключения к Yandex Managed MySQL.

---

2. Backend `.env`

В `Backend/.env` нужно создать конфигурацию:

DB_HOST=kz1-a-li88sf7alk3ogo1s.mdb.yandexcloud.kz
DB_PORT=3306
DB_USER=crm_user
DB_PASSWORD=пароль_из_privatebin
DB_NAME=crm

DB_SSL_CA=/app/certs/root.crt

SECRET_KEY=сгенерированный_секретный_ключ
ACCESS_TOKEN_EXPIRE_MINUTES=480
JWT_ALGORITHM=HS256

CORS_ALLOWED_ORIGINS=https://crm.amonitoring.kz

Важно: `DB_SSL_CA` должен указывать на путь к сертификату внутри Docker-контейнера.
Если сертификат на сервере лежит в `./certs/root.crt`, то внутри контейнера он будет доступен как `/app/certs/root.crt`.

---

3. Docker Compose

Файл `docker-compose.yml`:

services:
  backend:
    build:
      context: ./Backend
      dockerfile: Dockerfile
    container_name: amonitoring-crm-backend
    restart: always
    env_file:
      - ./Backend/.env
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - ./uploads:/app/uploads
      - ./certs:/app/certs:ro

Backend наружу напрямую не открываем. Он должен быть доступен только локально на сервере через `127.0.0.1:8000`, а наружу идти через nginx.

---

4. Backend Dockerfile

В `Backend/Dockerfile`:

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

---

5. Frontend

Frontend уже переведён на production API path:

```env
VITE_API_BASE_URL=/api
```

Перед деплоем frontend нужно собрать:

cd Frontend
npm install
npm run build

После сборки папку `Frontend/dist` нужно отдавать через nginx как статический frontend.

---

6. Nginx

Нужно настроить nginx так, чтобы:

https://crm.amonitoring.kz → отдавал React frontend из `Frontend/dist`
https://crm.amonitoring.kz/api → проксировал запросы на FastAPI backend

Важный момент: backend не имеет prefix `/api`. Поэтому nginx должен срезать `/api` при проксировании.

Пример логики:

location /api/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

Важно именно:

```nginx
proxy_pass http://127.0.0.1:8000/;
```

с `/` в конце, чтобы:

/api/requests → /requests
/api/auth/login → /auth/login
/api/docs → /docs

Если `/api` не срезать, backend будет получать `/api/requests` и вернёт 404.

---

7. Первый запуск backend

Из корня проекта:

docker compose build
docker compose up -d

Проверка логов:
docker compose logs -f backend

Проверка backend через сервер:
curl http://127.0.0.1:8000/docs

Проверка через nginx:
https://crm.amonitoring.kz/api/docs

---

8. Инициализация базы данных

Если база `crm` в Yandex MySQL пустая, нужно выполнить создание структуры таблиц.

Перед запуском выполнить:

docker exec -it amonitoring-crm-backend python db_sync.py
docker exec -it amonitoring-crm-backend python init_admin.py

---

9. Что проверить после запуска

После деплоя проверить:

1. https://crm.amonitoring.kz открывает frontend
2. https://crm.amonitoring.kz/api/docs открывает Swagger
3. POST `/api/auth/login` работает
4. Открывается список клиентов
5. Открывается список заявок
6. Работает создание заявки
7. Работает вкладка “Цены”
8. Работает вкладка “Склад”
9. Работает загрузка/скачивание файлов в заявке и клиенте
10. Работают уведомления в колокольчике
11. Backend после перезагрузки контейнера стартует автоматически
12. Загруженные файлы сохраняются в `uploads` и не пропадают после пересборки контейнера

---

10. Важные моменты

Backend не должен быть напрямую открыт наружу.
Папка `uploads` должна сохраняться между пересборками.
Папка `certs` должна содержать SSL CA-сертификат для Yandex Managed MySQL.
Если backend отдаёт 500 на `/cities`, `/clients`, `/requests`, первым делом нужно проверить `DB_SSL_CA` и наличие файла сертификата внутри контейнера:

docker exec -it amonitoring-crm-backend ls -la /app/certs
