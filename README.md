Репозиторий: https://github.com/fanartem/amonitoring-crm

Ниже инструкция по разворачиванию на сервере.

Стек проекта:

Frontend: React + Vite
Backend: Python FastAPI
Database: внешний Yandex Managed MySQL
Reverse proxy: nginx
Backend-запуск: Docker Compose

---

1. Структура проекта на сервере

Предлагаемая структура:

```text
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
```

Папка `uploads` нужна для хранения прикреплённых файлов к клиентам и заявкам. Её важно не удалять при пересборке контейнера.

Папка `certs` нужна для SSL-сертификата подключения к Yandex Managed MySQL.

---

2. Backend `.env`

В `Backend/.env` нужно создать конфигурацию:

```env
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
```

Важно: `DB_SSL_CA` должен указывать на путь к сертификату внутри Docker-контейнера.
Если сертификат на сервере лежит в `./certs/root.crt`, то внутри контейнера он будет доступен как `/app/certs/root.crt`.

---

3. Docker Compose

Файл `docker-compose.yml`:

```yaml
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
```

Backend наружу напрямую не открываем. Он должен быть доступен только локально на сервере через `127.0.0.1:8000`, а наружу идти через nginx.

---

4. Backend Dockerfile

В `Backend/Dockerfile`:

```dockerfile
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
```

---

5. Frontend

Frontend уже переведён на production API path:

```env
VITE_API_BASE_URL=/api
```

Перед деплоем frontend нужно собрать:

```bash
cd Frontend
npm install
npm run build
```

После сборки папку `Frontend/dist` нужно отдавать через nginx как статический frontend.