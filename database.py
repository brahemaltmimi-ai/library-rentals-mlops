import sqlite3
import os
from datetime import datetime
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", "rentals.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    Date TEXT NOT NULL,
    Hour INTEGER NOT NULL,
    Day_of_Week TEXT,
    Season TEXT,
    Holiday TEXT,
    Temperature_C REAL,
    Humidity_pct REAL,
    Wind_Speed_ms REAL,
    Visibility_m REAL,
    Solar_Radiation_MJm2 REAL,
    Rainfall_mm REAL,
    Library_Branch TEXT,
    Top_Category TEXT,
    Membership_Type TEXT,
    Rentals_Count REAL,
    Data_Source TEXT NOT NULL DEFAULT 'Actual',
    Model_Version TEXT,
    Created_At TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rentals_date ON rentals(Date);
CREATE INDEX IF NOT EXISTS idx_rentals_source ON rentals(Data_Source);
CREATE INDEX IF NOT EXISTS idx_rentals_branch ON rentals(Library_Branch);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.executescript(SCHEMA)


def is_empty():
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM rentals").fetchone()
        return row["n"] == 0


def seed_from_dataframe(df):
    """Bulk-insert the cleaned historical dataset as Data_Source='Actual'."""
    cols = ["Date", "Hour", "Day_of_Week", "Season", "Holiday", "Temperature_C",
            "Humidity_pct", "Wind_Speed_ms", "Visibility_m", "Solar_Radiation_MJm2",
            "Rainfall_mm", "Library_Branch", "Top_Category", "Membership_Type",
            "Rentals_Count"]

    df = df.copy()
    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str).str.slice(0, 10)
    if "Day_of_Week" not in df.columns and "Date" in df.columns:
        import pandas as pd
        df["Day_of_Week"] = pd.to_datetime(df["Date"]).dt.day_name()
    if "Hour" not in df.columns:
        df["Hour"] = 12

    for c in cols:
        if c not in df.columns:
            df[c] = None

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = [tuple(r) + (now,) for r in df[cols].values.tolist()]

    with get_conn() as conn:
        conn.executemany(
            f"""INSERT INTO rentals ({", ".join(cols)}, Data_Source, Created_At)
                VALUES ({", ".join(["?"] * len(cols))}, 'Actual', ?)""",
            rows,
        )


def get_distinct_branches():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT Library_Branch FROM rentals WHERE Library_Branch IS NOT NULL ORDER BY Library_Branch"
        ).fetchall()
        return [r["Library_Branch"] for r in rows]


def get_stats():
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM rentals").fetchone()["n"]
        actual = conn.execute("SELECT COUNT(*) AS n FROM rentals WHERE Data_Source='Actual'").fetchone()["n"]
        predicted = conn.execute("SELECT COUNT(*) AS n FROM rentals WHERE Data_Source='Predicted'").fetchone()["n"]
        avg_row = conn.execute("SELECT AVG(Rentals_Count) AS a FROM rentals").fetchone()
        avg_rentals = round(avg_row["a"], 1) if avg_row["a"] is not None else 0

        date_row = conn.execute("SELECT MIN(Date) AS mn, MAX(Date) AS mx FROM rentals").fetchone()
        branches_row = conn.execute(
            "SELECT COUNT(DISTINCT Library_Branch) AS n FROM rentals WHERE Library_Branch IS NOT NULL"
        ).fetchone()

        daily_trend = [dict(r) for r in conn.execute("""
            SELECT Date, Data_Source, AVG(Rentals_Count) AS avg_rentals
            FROM rentals GROUP BY Date, Data_Source ORDER BY Date
        """).fetchall()]

        hourly = [dict(r) for r in conn.execute("""
            SELECT Hour, Data_Source, AVG(Rentals_Count) AS avg_rentals
            FROM rentals GROUP BY Hour, Data_Source ORDER BY Hour
        """).fetchall()]

        by_branch = [dict(r) for r in conn.execute("""
            SELECT Library_Branch, AVG(Rentals_Count) AS avg_rentals
            FROM rentals WHERE Library_Branch IS NOT NULL
            GROUP BY Library_Branch ORDER BY avg_rentals DESC
        """).fetchall()]

        by_category = [dict(r) for r in conn.execute("""
            SELECT Top_Category, COUNT(*) AS n
            FROM rentals WHERE Top_Category IS NOT NULL
            GROUP BY Top_Category ORDER BY n DESC
        """).fetchall()]

        return {
            "total": total,
            "actual": actual,
            "predicted": predicted,
            "avg_rentals": avg_rentals,
            "date_min": date_row["mn"],
            "date_max": date_row["mx"],
            "branches": branches_row["n"],
            "daily_trend": daily_trend,
            "hourly": hourly,
            "by_branch": by_branch,
            "by_category": by_category,
        }


def get_records(page=1, per_page=25, source=None, branch=None, search=None):
    where = []
    params = []
    if source:
        where.append("Data_Source = ?")
        params.append(source)
    if branch:
        where.append("Library_Branch = ?")
        params.append(branch)
    if search:
        where.append("(Library_Branch LIKE ? OR Top_Category LIKE ? OR Date LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n FROM rentals {where_sql}", params).fetchone()["n"]
        offset = (page - 1) * per_page
        rows = conn.execute(
            f"""SELECT * FROM rentals {where_sql}
                ORDER BY Date DESC, Hour DESC, id DESC
                LIMIT ? OFFSET ?""",
            params + [per_page, offset],
        ).fetchall()

        return {
            "rows": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "per_page": per_page,
        }


def _clean_float(value, default=0.0):
    if value is None:
        return default
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
        if not value:
            return default
    return float(value)


def insert_prediction(payload, prediction, model_version):
    fields = {
        "Date": payload.get("Date"),
        "Hour": int(payload.get("Hour") or 0),
        "Day_of_Week": payload.get("Day_of_Week"),
        "Season": payload.get("Season"),
        "Holiday": payload.get("Holiday"),
        "Temperature_C": _clean_float(payload.get("Temperature_C")),
        "Humidity_pct": _clean_float(payload.get("Humidity_pct")),
        "Wind_Speed_ms": _clean_float(payload.get("Wind_Speed_ms")),
        "Visibility_m": _clean_float(payload.get("Visibility_m")),
        "Solar_Radiation_MJm2": _clean_float(payload.get("Solar_Radiation_MJm2")),
        "Rainfall_mm": _clean_float(payload.get("Rainfall_mm")),
        "Library_Branch": payload.get("Library_Branch"),
        "Top_Category": payload.get("Top_Category"),
        "Membership_Type": payload.get("Membership_Type"),
        "Rentals_Count": prediction,
        "Data_Source": "Predicted",
        "Model_Version": model_version,
        "Created_At": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    cols = list(fields.keys())
    with get_conn() as conn:
        cur = conn.execute(
            f"""INSERT INTO rentals ({", ".join(cols)}) VALUES ({", ".join(["?"] * len(cols))})""",
            [fields[c] for c in cols],
        )
        return cur.lastrowid


def delete_record(record_id):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM rentals WHERE id = ?", (record_id,))
        return cur.rowcount > 0
