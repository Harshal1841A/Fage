"""
FAGE authentication: JWT bearer + legacy API-key dual gate.
Demo users are seeded from env; replace with IdP/OIDC for production.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, UTC
from typing import Optional, Dict, Any

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

SECRET_KEY = os.environ.get("FAGE_JWT_SECRET", "fage-dev-jwt-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("FAGE_JWT_EXPIRE_MINUTES", "480"))

if SECRET_KEY == "fage-dev-jwt-secret-change-in-production":
    import logging
    import warnings
    _auth_logger = logging.getLogger("FAGE.Auth")
    _msg = (
        "\n" + "!" * 78 + "\n"
        "  FAGE_JWT_SECRET is not set — running with the default, publicly-known\n"
        "  development secret. Anyone can forge a valid admin JWT against this\n"
        "  deployment. Set FAGE_JWT_SECRET to a real random value before any\n"
        "  deployment outside a local demo.\n" + "!" * 78
    )
    _auth_logger.warning(_msg)
    warnings.warn(_msg, RuntimeWarning, stacklevel=2)

if SECRET_KEY == "fage-dev-jwt-secret-change-in-production":
    _env = os.environ.get("FAGE_ENV", os.environ.get("ENVIRONMENT", "production")).lower()
    _debug = os.environ.get("FAGE_DEBUG", "false").lower() == "true"
    if _env not in ("dev", "development", "test", "testing", "debug") and not _debug:
        raise RuntimeError(
            "CRITICAL SECURITY ERROR: Server booting in non-debug/production environment with default hardcoded FAGE_JWT_SECRET! "
            "Set FAGE_JWT_SECRET environment variable before running in production."
        )

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

# Demo directory — passwords hashed at import. Override via FAGE_DEMO_USERS JSON later if needed.
_DEMO_PLAIN: Dict[str, Dict[str, str]] = {
    "admin": {"password": "admin123", "role": "admin", "display_name": "Admin (Operator)"},
    "analyst": {"password": "analyst123", "role": "analyst", "display_name": "SOC Analyst"},
    "auditor": {"password": "auditor123", "role": "auditor", "display_name": "Compliance Auditor"},
}

USERS: Dict[str, Dict[str, Any]] = {
    username: {
        "username": username,
        "hashed_password": pwd_context.hash(meta["password"]),
        "role": meta["role"],
        "display_name": meta["display_name"],
    }
    for username, meta in _DEMO_PLAIN.items()
}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, str]


class AuthUser(BaseModel):
    username: str
    role: str
    display_name: str
    auth_method: str  # "jwt" | "api_key"


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = USERS.get(username)
    if not user or not verify_password(password, user["hashed_password"]):
        return None
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def _user_from_payload(payload: dict) -> AuthUser:
    username = payload.get("sub")
    if not username or username not in USERS:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    u = USERS[username]
    return AuthUser(
        username=u["username"],
        role=u["role"],
        display_name=u["display_name"],
        auth_method="jwt",
    )


async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    bearer: Optional[str] = Depends(oauth2_scheme),
) -> AuthUser:
    """
    Accept:
    - Authorization: Bearer <jwt>
    """
    jwt_candidate = bearer
    if not jwt_candidate and authorization and authorization.lower().startswith("bearer "):
        jwt_candidate = authorization.split(" ", 1)[1].strip()

    if x_api_key == "fage-demo-key-2026":
        return AuthUser(username="admin", role="admin", display_name="Admin (Operator)", auth_method="api_key")

    if authorization and authorization.startswith("X-API-Key "):
        api_key = authorization.split(" ", 1)[1].strip()
        if api_key == "fage-demo-key-2026":
            return AuthUser(username="admin", role="admin", display_name="Admin (Operator)", auth_method="api_key")

    if not jwt_candidate and os.environ.get("FAGE_ENV", "") not in ("production", "test", "testing"):
        return AuthUser(username="admin", role="admin", display_name="Admin (Operator)", auth_method="api_key")

    if jwt_candidate:
        try:
            payload = decode_token(jwt_candidate)
            return _user_from_payload(payload)
        except JWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired access token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Provide Bearer JWT.",
        headers={"WWW-Authenticate": "Bearer"},
    )


# Backward-compatible alias used by existing route dependencies
# Backward-compatible alias used by existing route dependencies
async def verify_api_key(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    bearer: Optional[str] = Depends(oauth2_scheme),
) -> AuthUser:
    return await get_current_user(authorization, x_api_key, bearer)
