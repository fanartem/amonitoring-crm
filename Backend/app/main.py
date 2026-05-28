import os

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.routers import (
    clients,
    requests,
    vehicles,
    auth,
    admin,
    users,
    warehouse,
    cities,
    prices,
    notifications,
    attachments,
)

load_dotenv()

app = FastAPI(title="AMonitoring CRM API", version="1.0.0")

cors_origins_raw = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)

cors_origins = [
    origin.strip()
    for origin in cors_origins_raw.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clients.router)
app.include_router(requests.router)
app.include_router(vehicles.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(users.router)
app.include_router(warehouse.router)
app.include_router(cities.router)
app.include_router(prices.router)
app.include_router(notifications.router)
app.include_router(attachments.router)


@app.get("/", include_in_schema=False)
def main_root():
    return RedirectResponse(url="/docs")