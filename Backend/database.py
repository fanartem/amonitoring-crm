from sqlalchemy import create_engine

DATABASE_URL = "mysql+pymysql://root:password@localhost/crm_db"

engine = create_engine(DATABASE_URL)