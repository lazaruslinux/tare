# Pinned by digest so two builds of the same commit produce the same image and
# a moved tag cannot slip a different base in between them. The tag rides in
# this comment for humans: python:3.14-slim
FROM python:3.14-slim@sha256:cad9a2c871761c413caa6fdd6441c783451e740a48aaeba60ae62a8b53525ef6

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copied on its own so the install layer stays cached across every build that
# changed only application code. Every pin carries a hash and --require-hashes
# makes pip refuse anything that does not match it.
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

COPY app ./app
COPY alembic.ini .
COPY migrations ./migrations
COPY manage.py .

RUN useradd --create-home tare

# Created and owned before the volume mounts over it: a named volume takes its
# ownership from the image's directory, so without this the mounted path
# arrives owned by root and the unprivileged process cannot write to it.
RUN mkdir -p /data/media && chown -R tare:tare /data

USER tare

EXPOSE 8000

# Bring the schema up, then serve. The upgrade is a no-op once the database is
# current, so restarts stay quick.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
