import os
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hail_libraries")
import numpy as np
import pandas as pd
import joblib
from flask import Flask, request, jsonify, render_template

import database as db

app = Flask(__name__)

model = joblib.load("model.pkl")
scaler = joblib.load("scaler.pkl")
feature_columns = joblib.load("feature_columns.pkl")  # exact column order from training

MODEL_VERSION = "xgb-v1"

# Options exposed to the prediction form — must exactly match the cleaned
# training categories (stripped + title-cased) so the model sees familiar values.
FORM_OPTIONS = {
    "Season": ["Winter", "Spring", "Summer", "Autumn"],
    "Holiday": ["No", "Yes"],
    "Library_Branch": ["University Branch", "Al Hamra Branch", "Al Rawdah Branch",
                        "Corniche Kiosk", "Downtown Central"],
    "Top_Category": ["Fiction", "Non-Fiction", "History", "Technology",
                      "Business", "Science", "Children", "Arabic Literature"],
    "Membership_Type": ["Walk-In", "Student", "Regular", "Premium"],
}


def _init_database_if_needed():
    """Create the SQLite schema and, on first run, seed it with the cleaned
    historical dataset (source='Actual') so the dashboard has real data."""
    db.init_db()
    if db.is_empty():
        csv_path = "cleaned_rentals.csv" if os.path.exists("cleaned_rentals.csv") else "hail_library_rentals.csv"
        try:
            if csv_path == "cleaned_rentals.csv":
                hist = pd.read_csv(csv_path, parse_dates=["Date"])
            else:
                # Fallback: raw csv wasn't cleaned by train_model.py — do a light clean here.
                hist = pd.read_csv(csv_path)
                hist["Date"] = pd.to_datetime(hist["Date"], format="%d/%m/%Y", errors="coerce")
                hist = hist.dropna(subset=["Date", "Rentals_Count"])
                for col in ["Temperature_C", "Humidity_pct", "Wind_Speed_ms", "Visibility_m",
                            "Solar_Radiation_MJm2", "Rainfall_mm"]:
                    hist[col] = pd.to_numeric(hist[col], errors="coerce")
                    hist[col] = hist[col].fillna(hist[col].median())
                for col in ["Library_Branch", "Top_Category", "Season", "Membership_Type"]:
                    hist[col] = hist[col].astype(str).str.strip().str.title()
                hist["Holiday"] = hist["Holiday"].astype(str).str.strip().str.title().replace({"Y": "Yes", "N": "No"})
            db.seed_from_dataframe(hist)
        except FileNotFoundError:
            pass  # dashboard will just show zero state; /predict still works


_init_database_if_needed()

# Same Ramadan windows used in EXERCISE-2 (extend as needed for other years)
RAMADAN_PERIODS = [
    (pd.Timestamp("2023-03-23"), pd.Timestamp("2023-04-21")),
    (pd.Timestamp("2024-03-11"), pd.Timestamp("2024-04-09")),
]


def temp_bin(t: float) -> str:
    # Exact thresholds from EXERCISE-2 Part 5
    if t < 25:
        return "Cool"
    elif t <= 49:
        return "Warm"
    else:
        return "Hot"


def is_ramadan(date: pd.Timestamp) -> int:
    for start, end in RAMADAN_PERIODS:
        if start <= date <= end:
            return 1
    return 0


REQUIRED_FIELDS = ["Date", "Hour", "Temperature_C", "Humidity_pct", "Wind_Speed_ms",
                    "Visibility_m", "Solar_Radiation_MJm2", "Rainfall_mm"]


def build_feature_row(data: dict) -> pd.DataFrame:
    """
    Reproduces the EXERCISE-2 feature engineering (Part 5 + Part 6) from a
    plain, human-readable JSON payload, then aligns to feature_columns.pkl.
    """
    # Validate presence/non-blankness up front so the error points at the
    # exact field, instead of surfacing a confusing NaN/model-internals error
    # later on.
    for field in REQUIRED_FIELDS:
        value = data.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValueError(f"'{field}' is required and cannot be blank")

    try:
        date = pd.to_datetime(data["Date"])  # e.g. "2024-07-15"
    except (ValueError, TypeError):
        raise ValueError(f"'Date' is not a valid date: {data['Date']!r}")
    if pd.isna(date):
        raise ValueError(f"'Date' is not a valid date: {data['Date']!r}")

    try:
        hour = int(data["Hour"])              # 0-23
    except (ValueError, TypeError):
        raise ValueError(f"'Hour' must be a whole number: {data['Hour']!r}")
    if not (0 <= hour <= 23):
        raise ValueError(f"'Hour' must be between 0 and 23, got {hour}")

    def _to_float(field):
        raw = data[field]
        if isinstance(raw, str):
            raw = raw.strip().replace(",", ".")  # tolerate comma decimals
        try:
            return float(raw)
        except (ValueError, TypeError):
            raise ValueError(f"'{field}' must be a number: {data[field]!r}")

    temperature_c = _to_float("Temperature_C")
    humidity_pct = _to_float("Humidity_pct")

    row = {
        "Temperature_C": temperature_c,
        "Humidity_pct": humidity_pct,
        "Wind_Speed_ms": _to_float("Wind_Speed_ms"),
        "Visibility_m": _to_float("Visibility_m"),
        "Solar_Radiation_MJm2": _to_float("Solar_Radiation_MJm2"),
        "Rainfall_mm": _to_float("Rainfall_mm"),
        # Comfort_Index - exact formula from EXERCISE-2 cell 66
        "Comfort_Index": temperature_c - 0.55 * (1 - humidity_pct / 100) * (temperature_c - 14.5),
        # Is_Peak_Hour - exact rule from EXERCISE-2 cell 62
        "Is_Peak_Hour": 1 if (9 <= hour <= 11 or 16 <= hour <= 19) else 0,
        # Is_Weekend - Friday=4, Saturday=5 (cell 65)
        "Is_Weekend": 1 if date.weekday() in (4, 5) else 0,
        # Is_Ramadan - same date windows as training (cell 68)
        "Is_Ramadan": is_ramadan(date),
    }

    # Cyclical encodings (cell 67) - Hour/Month themselves are dropped
    month = date.month
    row["Hour_sin"] = np.sin(2 * np.pi * hour / 24)
    row["Hour_cos"] = np.cos(2 * np.pi * hour / 24)
    row["Month_sin"] = np.sin(2 * np.pi * month / 12)
    row["Month_cos"] = np.cos(2 * np.pi * month / 12)

    # One-hot categoricals - built with get_dummies so we never guess which
    # category was the dropped baseline; reindex() below handles the rest.
    categorical = {
        "Season": data.get("Season", "Unknown"),
        "Library_Branch": data.get("Library_Branch", "Unknown"),
        "Top_Category": data.get("Top_Category", "Unknown"),
        "Membership_Type": data.get("Membership_Type", "Unknown"),
        "Holiday": data.get("Holiday", "No"),
        "Temperature_Bin": temp_bin(temperature_c),
        "Day_of_Week": date.day_name(),          # e.g. "Tuesday"
        "q": f"{date.quarter}",                   # quarter dummies -> q_2, q_3, q_4
    }
    cat_df = pd.DataFrame([categorical])
    cat_dummies = pd.get_dummies(cat_df)  # default prefix = column name, e.g. q_3, Season_Summer

    df = pd.DataFrame([row])
    df = pd.concat([df, cat_dummies], axis=1)

    # Align exactly to training column order/names. Any expected column not
    # produced above (a dropped baseline category) becomes 0 - this is what
    # correctly reproduces one-hot-with-drop_first behavior.
    df = df.reindex(columns=feature_columns, fill_value=0)
    return df


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict", methods=["POST"])
def predict():
    """Original API contract — unchanged. Pure prediction, no DB write."""
    data = None
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Request body must be JSON"}), 400

        features_df = build_feature_row(data)
        features_scaled = scaler.transform(features_df)  # transform, never fit_transform
        prediction = model.predict(features_scaled)

        return jsonify({"predicted_rentals": float(prediction[0])})

    except KeyError as e:
        logger.warning("predict 400 (missing field %s) — payload: %s", e, data)
        return jsonify({"error": f"Missing required field: {e}"}), 400
    except (ValueError, TypeError) as e:
        logger.warning("predict 400 (invalid input: %s) — payload: %s", e, data)
        return jsonify({"error": f"Invalid input: {e}"}), 400
    except Exception as e:
        logger.exception("predict 400 (unexpected) — payload: %s", data)
        return jsonify({"error": str(e)}), 400


@app.route("/")
def dashboard_page():
    return render_template("dashboard.html", active="dashboard")


@app.route("/predict-form")
def predict_page():
    return render_template("predict.html", active="predict", options=FORM_OPTIONS)


@app.route("/records")
def records_page():
    return render_template("records.html", active="records", options=FORM_OPTIONS)


# ------------------------------------------------------------------
# JSON APIs backing the UI
# ------------------------------------------------------------------

@app.route("/api/stats")
def api_stats():
    return jsonify(db.get_stats())


@app.route("/api/records")
def api_records():
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(max(int(request.args.get("per_page", 25)), 1), 200)
    source = request.args.get("source") or None
    branch = request.args.get("branch") or None
    search = request.args.get("q") or None
    return jsonify(db.get_records(page=page, per_page=per_page, source=source, branch=branch, search=search))


@app.route("/api/branches")
def api_branches():
    return jsonify({"branches": db.get_distinct_branches()})


@app.route("/api/predict-and-save", methods=["POST"])
def api_predict_and_save():
    """Used by the sequential prediction wizard: predicts AND persists the
    row to the database with Data_Source='Predicted', so it's clearly
    distinguishable from real historical ('Actual') records."""
    data = None
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Request body must be JSON"}), 400

        features_df = build_feature_row(data)
        features_scaled = scaler.transform(features_df)
        prediction = float(model.predict(features_scaled)[0])
        prediction = max(prediction, 0.0)  # rentals can't be negative

        date = pd.to_datetime(data["Date"])
        save_payload = dict(data)
        save_payload["Day_of_Week"] = date.day_name()

        new_id = db.insert_prediction(save_payload, prediction, model_version=MODEL_VERSION)

        return jsonify({
            "id": new_id,
            "predicted_rentals": round(prediction, 1),
            "data_source": "Predicted",
            "model_version": MODEL_VERSION,
        })

    except KeyError as e:
        logger.warning("predict-and-save 400 (missing field %s) — payload: %s", e, data)
        return jsonify({"error": f"Missing required field: {e}"}), 400
    except (ValueError, TypeError) as e:
        logger.warning("predict-and-save 400 (invalid input: %s) — payload: %s", e, data)
        return jsonify({"error": f"Invalid input: {e}"}), 400
    except Exception as e:
        logger.exception("predict-and-save 400 (unexpected) — payload: %s", data)
        return jsonify({"error": str(e)}), 400


@app.route("/api/records/<int:record_id>", methods=["DELETE"])
def api_delete_record(record_id):
    """Permanently deletes a single record (Actual or Predicted) by id."""
    try:
        deleted = db.delete_record(record_id)
        if not deleted:
            return jsonify({"error": f"Record {record_id} not found"}), 404
        return jsonify({"deleted": record_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)