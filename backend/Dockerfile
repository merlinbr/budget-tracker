FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.lock ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.lock

# Application code stays root-owned; the runtime user gets a writable data directory only.
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY migrations ./migrations

RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/data \
    && chown app:app /app/data \
    && chmod 755 /app /app/app /app/migrations \
    && find /app/app /app/migrations -type d -exec chmod 755 {} + \
    && find /app/app /app/migrations -type f -exec chmod 644 {} +
USER app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
