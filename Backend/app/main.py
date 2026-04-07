from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import clients, requests, vehicles

app = FastAPI(title="AMonitoring CRM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем роутеры
app.include_router(clients.router)
app.include_router(requests.router)
app.include_router(vehicles.router)

@app.get("/", include_in_schema=False)
def main_root():
    return RedirectResponse(url="/docs")