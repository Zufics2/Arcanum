"""Built-in profile icons. Files live in frontend/public/avatars/<name>.jpg."""

import secrets

DEFAULT_AVATARS = (
    "lock-indigo",
    "lock-red",
    "lock-orange",
    "lock-yellow",
    "lock-green",
    "lock-cyan",
    "lock-purple",
    "lock-pink",
    "lock-white",
)

# Custom avatars are resized in the browser to 256x256, so this is a generous cap.
MAX_AVATAR_BYTES = 1024 * 1024


def random_default_avatar() -> str:
    return secrets.choice(DEFAULT_AVATARS)
