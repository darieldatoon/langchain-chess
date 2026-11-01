"""Who may call the deployment with a "Sign in with LangSmith" token.

LangSmith issues these tokens to any user of any OAuth app, so only tokens issued to this app
for members of this deployment's org get in. API keys never reach this handler:
`allow_langsmith_api_keys` in langgraph.json sends requests without an `Authorization` header to
LangSmith's own key check, and `langgraph dev` lets them through.
"""

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache
from typing import Any

import jwt
from langgraph_sdk import Auth

from langchain_chess_server.settings import ServerSettings

ISSUER = "https://api.smith.langchain.com"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"

type SigningKey = Callable[[str], Any]
"""The public key that signed a token, looked up by its `kid`."""


@dataclass(frozen=True)
class AccessPolicy:
    """Unset refuses every token: a deployment without the OAuth app takes API keys only."""

    client_id: str | None
    organization_id: str | None


def policy_of(settings: ServerSettings) -> AccessPolicy:
    return AccessPolicy(settings.oauth_client_id, settings.allowed_organization_id)


def refusal(policy: AccessPolicy, claims: Mapping[str, Any]) -> str | None:
    """Why a verified token may not use this deployment, or None when it may."""
    if policy.client_id is None or claims.get("client_id") != policy.client_id:
        return "Sign in through the LangChain Chess app to use this server."
    if policy.organization_id is None or claims.get("organization_id") != policy.organization_id:
        return "This LangSmith account isn't in the organization that runs this server."
    return None


def verified_claims(token: str, signing_key: SigningKey) -> dict[str, Any]:
    # Without `resource` at sign-in the audience is /userinfo only, and such a token fails here.
    return jwt.decode(
        token,
        signing_key(token),
        algorithms=["EdDSA"],
        issuer=ISSUER,
        audience=ISSUER,
        options={"require": ["exp", "iss", "aud", "sub"]},
    )


def user_for(
    authorization: str | None, policy: AccessPolicy, signing_key: SigningKey
) -> Auth.types.MinimalUserDict:
    scheme, _, token = (authorization or "").strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Auth.exceptions.HTTPException(
            401, "Sign in with LangSmith, or send a LangSmith API key as X-Api-Key."
        )
    try:
        claims = verified_claims(token.strip(), signing_key)
    except jwt.PyJWTError as error:
        raise Auth.exceptions.HTTPException(
            401, "Your LangSmith sign-in is invalid or has expired. Sign in again."
        ) from error
    if reason := refusal(policy, claims):
        raise Auth.exceptions.HTTPException(403, reason)
    return {"identity": claims["sub"]}


@cache
def _policy() -> AccessPolicy:
    return policy_of(ServerSettings())


@cache
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(JWKS_URL)


def _signing_key(token: str) -> Any:
    return _jwks().get_signing_key_from_jwt(token).key


auth = Auth()


@auth.authenticate
async def authenticate(authorization: str | None) -> Auth.types.MinimalUserDict:
    # Off the event loop: settings read `.env`, and PyJWKClient fetches keys synchronously.
    return await asyncio.to_thread(lambda: user_for(authorization, _policy(), _signing_key))
