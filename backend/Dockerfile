# Croquis backend (FastAPI). Used by Render (see render.yaml), but works on any Docker host.
FROM python:3.13-slim

# DejaVu fonts let the tailor-sheet PDF print ₹, arrows and accented names.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Run as a normal user, not root.
RUN useradd --create-home croquis
USER croquis

# Render sets PORT. --proxy-headers so the real client address and https are seen behind the host's proxy.
CMD ["sh", "-c", "uvicorn app.main:build --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
