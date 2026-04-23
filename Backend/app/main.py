from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import clients, requests, vehicles, auth, admin

app = FastAPI(title="AMonitoring CRM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Разрешаем запросы с любых адресов
    allow_credentials=True,
    allow_methods=["*"], # Разрешаем GET, POST и т.д.
    allow_headers=["*"], # Разрешаем передавать Authorization Token
)

# Подключаем роутеры
app.include_router(clients.router)
app.include_router(requests.router)
app.include_router(vehicles.router)
app.include_router(auth.router)
app.include_router(admin.router)

@app.get("/", include_in_schema=False)
def main_root():
    return RedirectResponse(url="/docs")