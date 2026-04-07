import pymysql

def get_connection():
    return pymysql.connect(
        host="localhost",
        user="root",
        password="root",
        database="crm_db",
        cursorclass=pymysql.cursors.DictCursor
    )