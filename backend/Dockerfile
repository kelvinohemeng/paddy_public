# The paddy Django API as a container image.
#
# An image is a frozen, ready-to-run copy of the app plus everything it needs
# (Linux, Python, GDAL, the packages). Any host that runs containers (Coolify,
# Render's Docker mode, your laptop) runs the same image the same way.
#
# Build it (from the repo root):
#     docker build -t paddy-backend backend
# Run it (settings come from environment variables, never from the image):
#     docker run --env-file backend/.env -p 8000:8000 paddy-backend
#
# Each instruction below adds a "layer". Docker caches layers and only rebuilds
# from the first one whose inputs changed, which is why the slow, rarely
# changing steps (system packages, Python packages) come before copying the
# code: editing a .py file then rebuilds in seconds.

# 1. Start from an official slim Debian image that already has Python 3.11
#    (the version the Pipfile pins).
FROM python:3.11-slim-bookworm

# 2. Python settings for containers: don't write .pyc files, print logs
#    straight away (so the host shows them live), and keep pip quiet and
#    small.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 3. GeoDjango's system libraries. gdal-bin brings GDAL plus the GEOS and
#    PROJ libraries it depends on (the Linux version of what OSGeo4W provides
#    on Windows); binutils lets Python find those libraries by name. Clearing
#    the apt lists afterwards keeps the image smaller.
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils gdal-bin \
    && rm -rf /var/lib/apt/lists/*

# 4. Run as an ordinary user instead of root, so a bug in the app can't
#    change the container's system files.
RUN useradd --create-home paddy
WORKDIR /app
RUN chown paddy:paddy /app
# WORKDIR creates /app owned by root; the app writes collected static
# files into /app/staticfiles at start-up, so the paddy user must own it.

# 5. Python packages, from the lock file only. --deploy refuses to build if
#    Pipfile.lock is out of date, --system installs straight into the image's
#    Python (a container doesn't need a virtualenv), and dev packages
#    (Bandit) are left out. pipenv itself is removed once it's done its job.
COPY Pipfile Pipfile.lock ./
RUN pip install pipenv \
    && pipenv install --system --deploy \
    && pip uninstall -y pipenv

# 6. The code itself (minus whatever .dockerignore excludes, such as .env).
COPY --chown=paddy:paddy . .
USER paddy

# 7. What the container does when it starts. Migrations and collectstatic
#    run here, not while building, because both need the real settings
#    (database, secret key), and those only exist when the container runs.
#    Then gunicorn serves the app on $PORT (hosts set it; 8000 otherwise).
#    `exec` hands gunicorn the main process, so a stop signal from the host
#    reaches it and it shuts down cleanly.
#    shortcut: migrating on start assumes one container at a time; run
#    `manage.py migrate` as a separate release step before running two.
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-2}"]
