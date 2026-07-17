# Docker Troubleshooting Guide

Common issues when building, running, or deploying this project's Docker container — with real fixes.

---

## 1. `docker: command not found` (inside WSL)

**Symptom**
```
wsl: command not found
docker --version
The command 'docker' could not be found in this WSL 2 distro.
```

**Cause**
Docker Desktop is installed on Windows but WSL integration isn't enabled for your distro.

**Fix**
1. Open **Docker Desktop** (must be running in the background)
2. **Settings → Resources → WSL Integration**
3. Enable **"Enable integration with my default WSL distro"**
4. Toggle **on** your specific distro (e.g. Ubuntu) in the list below
5. **Apply & Restart**
6. Re-check: `docker --version`

> Simpler alternative: skip WSL entirely and run Docker commands directly from **PowerShell** — this project doesn't require WSL.

---

## 2. `ModuleNotFoundError: No module named 'xgboost'` (or similar, when running `app.py` locally — not in Docker)

**Symptom**
```
File "...\joblib\numpy_pickle.py", ...
ModuleNotFoundError: No module named 'xgboost'
```

**Cause**
`model.pkl` was serialized with a library (e.g. XGBoost) that isn't installed in your current Python environment. Unpickling requires the *exact same libraries* available, not just scikit-learn.

**Fix**
```bash
pip install xgboost
```
And make sure it's listed in `requirements.txt` so the Docker image installs it too:
```
flask
joblib
scikit-learn
numpy
pandas
xgboost
```

---

## 3. `FileNotFoundError: No such file or directory: 'feature_columns.pkl'` (or `model.pkl` / `scaler.pkl`)

**Cause**
One of the three required `.pkl` files isn't in the same folder as `app.py` — either it wasn't generated during training, or it wasn't copied into the project directory.

**Fix**
- Confirm all three files exist side-by-side:
  ```
  app.py
  model.pkl
  scaler.pkl
  feature_columns.pkl
  ```
- If a file is missing, regenerate it from your training notebook/script with `joblib.dump(...)`.
- **Inside Docker specifically**: make sure these files are **not** excluded by `.dockerignore`, and that `COPY . .` in the `Dockerfile` runs *before* `pip install` fails silently — check the build log for a `COPY` step that skipped them.

---

## 4. `UserWarning: ... If you are loading a serialized model ... older version of XGBoost` / `InconsistentVersionWarning ... scikit-learn`

**Symptom**
```
UserWarning: ... please export the model by calling `Booster.save_model` ...
InconsistentVersionWarning: Trying to unpickle estimator StandardScaler from version 1.5.1 when using version 1.9.0.
```

**Cause**
The model/scaler were trained with older XGBoost/scikit-learn versions than what's installed now. This is a **warning, not an error** — the app still runs.

**When to actually worry**
- If predictions look clearly wrong or inconsistent with training-time results.
- If you're deploying to production long-term (version drift compounds over time).

**Recommended fix (optional but best practice)**
Pin exact versions in `requirements.txt` to match what the model was trained with:
```
scikit-learn==1.5.1
xgboost==<training-version>
```
Or retrain the model with your current library versions using `train_model.py`.

---

## 5. Build fails at `RUN pip install --no-cache-dir -r requirements.txt`

**Common causes**
- A typo or invalid package name in `requirements.txt`
- No internet access during build (corporate proxy/firewall)
- A package requiring system-level build tools not present in `python:3.11-slim`

**Fix**
- Double-check `requirements.txt` has no stray characters.
- Try building with verbose output to isolate the failing package:
  ```bash
  docker build --progress=plain -t rentals-api .
  ```
- If a package needs compilation (e.g. some C-extension libraries), consider switching the base image from `python:3.11-slim` to `python:3.11` (full image, larger but has more build tools).

---

## 6. `docker run` starts, but `curl http://localhost:5000/...` fails to connect

**Common causes & fixes**

| Cause | Fix |
|---|---|
| Port not published | Make sure you ran with `-p 5000:5000`, not just `docker run rentals-api` |
| Container already exited | Run `docker ps -a` to check status; check `docker logs <container_id>` for the crash reason |
| Port already in use on host | Use a different host port: `docker run -p 5001:5000 rentals-api`, then call `localhost:5001` |
| Testing from a **different terminal** while the container runs in foreground | This is expected — open a **second terminal window** to run `curl` while the first one keeps the container running |

---

## 7. `Address already in use` when starting the container or `python app.py` locally

**Cause**
Another process (maybe a previous run you forgot to stop) is already bound to port 5000.

**Fix**
```powershell
# Find what's using port 5000
netstat -ano | findstr :5000

# Kill it by PID (last column from the output above)
taskkill /PID <pid> /F
```
Or simply run on a different port:
```bash
docker run -p 5001:5000 rentals-api
```

---

## 8. PowerShell JSON quoting errors with `curl.exe -d '...'`

**Symptom**
```
Invalid JSON
```
or the request silently doesn't reach `/predict` as expected.

**Cause**
PowerShell doesn't handle single-quoted JSON the same way Bash/Zsh does — inner double quotes need to be escaped.

**Fix**
Escape inner quotes with `\"`:
```powershell
curl.exe -X POST http://localhost:5000/predict -H "Content-Type: application/json" -d '{\"Hour\": 14, \"Temperature_C\": 30}'
```
Or use a `.json` file and `--data @file.json` instead to avoid quoting issues entirely:
```powershell
curl.exe -X POST http://localhost:5000/predict -H "Content-Type: application/json" --data "@payload.json"
```

---

## Quick Diagnostic Checklist

When something doesn't work, check in this order:

1. Is Docker Desktop actually running?
2. Did `docker build` finish with no errors? (scroll up in the log)
3. Are `model.pkl`, `scaler.pkl`, `feature_columns.pkl` present in the build context?
4. Does `requirements.txt` list every package the model needs to unpickle (e.g. `xgboost`)?
5. Is the container actually running? (`docker ps`)
6. Is the port published and not colliding with something else?
7. Are you testing from a **separate terminal** than the one running the container?
