# Autoscaling Lab Flask service

This service is intentionally independent from the React console. It exposes a deterministic,
request-scoped CPU workload that can later be deployed behind Kubernetes HPA.

## Local

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
python app.py
```

The service listens on `http://localhost:5000`. Set `MAX_WORK_DURATION` to change the maximum
accepted workload duration.

## API

- `GET /` — service identity and health
- `GET /health` — health status
- `GET /info` — runtime metadata
- `GET /cpu?duration=1` — CPU-only workload
- `GET /work?duration=1` — CPU workload with request metadata