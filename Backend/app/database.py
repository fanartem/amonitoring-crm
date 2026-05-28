import os
import pymysql
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = int(os.getenv("DB_PORT", "3306"))
    db_user = os.getenv("DB_USER", "root")
    db_password = os.getenv("DB_PASSWORD", "root")
    db_name = os.getenv("DB_NAME", "crm_db")

    db_ssl_ca = os.getenv("DB_SSL_CA")

    connect_kwargs = {
        "host": db_host,
        "port": db_port,
        "user": db_user,
        "password": db_password,
        "database": db_name,
        "cursorclass": pymysql.cursors.DictCursor,
        "charset": "utf8mb4",
        "autocommit": False,
    }

    if db_ssl_ca:
        connect_kwargs["ssl"] = {
            "ca": db_ssl_ca,
        }

    return pymysql.connect(**connect_kwargs)