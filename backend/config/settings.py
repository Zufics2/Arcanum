"""
Django settings for the Arcanum backend.

All secrets and environment-specific values are read from environment
variables (or a `.env` file in the repository root for local development).
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
    STORAGE_QUOTA_GB=(int, 5),
)

# Local development: read the repo-level .env if it exists.
# In Docker the variables come from `env_file` in docker-compose.yml.
environ.Env.read_env(REPO_ROOT / ".env", overwrite=False)

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "drf_spectacular",
    "drf_spectacular_sidecar",  # self-hosted Swagger UI assets (no third-party CDN)
    # Local
    "accounts",
    "storage",
    "sharing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://arcanum:arcanum@localhost:5432/arcanum",
    ),
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = env("STATIC_ROOT", default=str(BASE_DIR / "staticfiles"))

# Encrypted blobs are stored here (a Docker volume in production).
MEDIA_URL = "media/"
MEDIA_ROOT = env("MEDIA_ROOT", default=str(BASE_DIR / "media"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Arcanum API",
    "DESCRIPTION": "Zero-knowledge cloud storage. The server only ever sees ciphertext.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Serve Swagger UI from our own static files instead of cdn.jsdelivr.net:
    # no third-party scripts, and it works under the strict CSP set in nginx.
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
}

# The refresh token is also kept in an httpOnly cookie, so a page reload keeps the session
# (the user only re-enters the password to unlock keys). JS can't read the cookie;
# encryption keys themselves are never stored anywhere but in browser memory.
REFRESH_COOKIE_NAME = "arcanum_session"
REFRESH_COOKIE_PATH = "/api/auth/"
REFRESH_COOKIE_SECURE = env.bool("REFRESH_COOKIE_SECURE", default=not DEBUG)

# Behind nginx (and possibly a TLS tunnel) the original scheme arrives in X-Forwarded-Proto.
# Only the proxy sets this header in Docker; local runserver has no proxy and never sees it.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --- Storage ---
STORAGE_QUOTA_BYTES = env("STORAGE_QUOTA_GB") * 1024**3

# --- CORS / CSRF (only needed when the frontend runs on another origin, e.g. local dev) ---
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True  # the session cookie must travel with auth requests
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# --- Privacy: never log client IP addresses ---
# Django's default "django.server" handler prints request lines only in runserver;
# production runs under gunicorn with access logging disabled.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {"handlers": ["console"], "level": "WARNING"},
}
