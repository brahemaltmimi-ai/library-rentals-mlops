"""
train_model.py
Reproduces the EXERCISE-2 cleaning + feature-engineering pipeline exactly,
trains the XGBoost regressor, and saves the three artifacts app.py expects:
    model.pkl, scaler.pkl, feature_columns.pkl
"""
import numpy as np
import pandas as pd
import joblib
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from xgboost import XGBRegressor

RAMADAN_PERIODS = [
    (pd.Timestamp("2023-03-23"), pd.Timestamp("2023-04-21")),
    (pd.Timestamp("2024-03-11"), pd.Timestamp("2024-04-09")),
]


def temp_bin(t):
    if t < 25:
        return "Cool"
    elif t <= 49:
        return "Warm"
    else:
        return "Hot"


def is_ramadan(d):
    for start, end in RAMADAN_PERIODS:
        if start <= d <= end:
            return 1
    return 0


def load_and_clean(path="hail_library_rentals.csv"):
    df = pd.read_csv(path)

    # --- Dates ---
    df["Date"] = pd.to_datetime(df["Date"], format="%d/%m/%Y", errors="coerce")
    df = df.dropna(subset=["Date"])

    # --- Negative values -> NaN ---
    df.loc[df["Temperature_C"] < 0, "Temperature_C"] = np.nan
    df.loc[df["Rentals_Count"] < 0, "Rentals_Count"] = np.nan

    # --- Numeric imputation (median) ---
    numeric_cols = [
        "Temperature_C", "Humidity_pct", "Wind_Speed_ms",
        "Visibility_m", "Solar_Radiation_MJm2", "Rainfall_mm",
    ]
    for col in numeric_cols:
        df[col] = df[col].fillna(df[col].median())

    # --- Standardize text categoricals (strip + title case) ---
    for col in ["Library_Branch", "Top_Category", "Season", "Membership_Type"]:
        df[col] = df[col].astype(str).str.strip().str.title()

    # --- Standardize Yes/No columns ---
    yn_map = {"y": "Yes", "yes": "Yes", "n": "No", "no": "No"}
    for col in ["Holiday", "Functioning_Day"]:
        df[col] = df[col].astype(str).str.strip().str.lower().map(yn_map)

    # --- Fill remaining categorical gaps ---
    for col in ["Season", "Holiday", "Functioning_Day", "Library_Branch",
                "Top_Category", "Membership_Type"]:
        df[col] = df[col].replace("", np.nan).replace("Nan", np.nan)
        df[col] = df[col].fillna("Unknown")

    # --- Drop Snowfall (constant / not used) ---
    if "Snowfall_cm" in df.columns:
        df = df.drop(columns=["Snowfall_cm"])

    # --- Keep only open days, drop rows with no target ---
    df = df[df["Functioning_Day"] == "Yes"]
    df = df.dropna(subset=["Rentals_Count"])

    return df.reset_index(drop=True)


def engineer_features(df):
    df = df.copy()

    df["Month"] = df["Date"].dt.month
    df["q"] = df["Date"].dt.quarter

    df["Is_Peak_Hour"] = df["Hour"].apply(lambda h: 1 if (9 <= h <= 11 or 16 <= h <= 19) else 0)
    df["Temperature_Bin"] = df["Temperature_C"].apply(temp_bin)
    df["Is_Weekend"] = df["Date"].dt.weekday.apply(lambda d: 1 if d in (4, 5) else 0)
    df["Comfort_Index"] = df["Temperature_C"] - 0.55 * (1 - df["Humidity_pct"] / 100) * (df["Temperature_C"] - 14.5)
    df["Is_Ramadan"] = df["Date"].apply(is_ramadan)

    df["Hour_sin"] = np.sin(2 * np.pi * df["Hour"] / 24)
    df["Hour_cos"] = np.cos(2 * np.pi * df["Hour"] / 24)
    df["Month_sin"] = np.sin(2 * np.pi * df["Month"] / 12)
    df["Month_cos"] = np.cos(2 * np.pi * df["Month"] / 12)
    df = df.drop(columns=["Hour", "Month"])

    df["q"] = df["q"].astype(str)  # so get_dummies makes q_2, q_3, q_4 (not numeric)

    df = pd.get_dummies(
        df,
        columns=["Season", "Library_Branch", "Top_Category", "Membership_Type",
                  "Holiday", "Functioning_Day", "Temperature_Bin", "Day_of_Week", "q"],
        drop_first=True,
    )

    df = df.drop(columns=["Date"])
    return df


def main():
    print("Loading & cleaning data ...")
    raw = load_and_clean()
    print(f"  clean shape: {raw.shape}")

    print("Engineering features ...")
    feat = engineer_features(raw)

    X = feat.drop(columns=["Rentals_Count"])
    y = feat["Rentals_Count"]
    feature_columns = list(X.columns)
    print(f"  feature matrix: {X.shape}")

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    print("Training XGBoost regressor ...")
    model = XGBRegressor(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(X_train_scaled, y_train)

    y_pred = model.predict(X_test_scaled)
    r2 = r2_score(y_test, y_pred)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    print(f"  R2={r2:.4f}  MAE={mae:.4f}  RMSE={rmse:.4f}")

    joblib.dump(model, "model.pkl")
    joblib.dump(scaler, "scaler.pkl")
    joblib.dump(feature_columns, "feature_columns.pkl")
    with open("model_metrics.txt", "w") as f:
        f.write(f"R2={r2:.4f}\nMAE={mae:.4f}\nRMSE={rmse:.4f}\nn_features={len(feature_columns)}\nn_train={len(X_train)}\nn_test={len(X_test)}\n")
    print("Saved model.pkl, scaler.pkl, feature_columns.pkl")

    # Also export the cleaned, feature-free "actual" dataset for the database
    raw.to_csv("cleaned_rentals.csv", index=False)
    print("Saved cleaned_rentals.csv")


if __name__ == "__main__":
    main()
