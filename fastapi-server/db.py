from sqlalchemy import create_engine

DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/chunks_db"

engine = create_engine(DATABASE_URL)