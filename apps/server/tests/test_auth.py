import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from jwt.algorithms import OKPAlgorithm
from langgraph_sdk import Auth

from langchain_chess_server import auth as auth_module
from langchain_chess_server.auth import (
    ISSUER,
    JWKS_URL,
    AccessPolicy,
    authenticate,
    policy_of,
    refusal,
    user_for,
)
from langchain_chess_server.settings import ServerSettings

POLICY = AccessPolicy(client_id="chess-app", organization_id="org-1")
KEY = Ed25519PrivateKey.generate()
OTHER_KEY = Ed25519PrivateKey.generate()


def claims(**overrides: Any) -> dict[str, Any]:
    return {
        "iss": ISSUER,
        "aud": ISSUER,
        "sub": "user-1",
        "exp": int(time.time()) + 300,
        "client_id": "chess-app",
        "organization_id": "org-1",
        "tenant_id": "workspace-1",
    } | overrides


def token(key: Ed25519PrivateKey = KEY, **overrides: Any) -> str:
    return jwt.encode(claims(**overrides), key, algorithm="EdDSA")


def our_key(_token: str) -> Any:
    return KEY.public_key()


def test_only_our_app_and_org_get_in():
    assert refusal(POLICY, claims()) is None
    assert "LangChain Chess app" in str(refusal(POLICY, claims(client_id="other-app")))
    assert "organization" in str(refusal(POLICY, claims(organization_id="org-2")))
    assert "organization" in str(refusal(POLICY, claims(organization_id=None)))


@pytest.mark.parametrize(
    "policy",
    [AccessPolicy(None, "org-1"), AccessPolicy("chess-app", None), AccessPolicy(None, None)],
)
def test_an_unset_policy_refuses_every_token(policy: AccessPolicy):
    assert refusal(policy, claims()) is not None


def test_a_member_gets_in_as_their_langsmith_user():
    assert user_for(f"Bearer {token()}", POLICY, our_key) == {"identity": "user-1"}
    assert user_for(f"  bearer   {token()} ", POLICY, our_key) == {"identity": "user-1"}


@pytest.mark.parametrize("authorization", [None, "", "Bearer", "Bearer  ", "Basic abc"])
def test_no_bearer_token_is_401(authorization: str | None):
    with pytest.raises(Auth.exceptions.HTTPException) as raised:
        user_for(authorization, POLICY, our_key)
    assert raised.value.status_code == 401


@pytest.mark.parametrize(
    "bad",
    [
        token(OTHER_KEY),
        token(exp=int(time.time()) - 60),
        token(aud=f"{ISSUER}/userinfo"),
        token(iss="https://eu.api.smith.langchain.com"),
        jwt.encode({k: v for k, v in claims().items() if k != "sub"}, KEY, algorithm="EdDSA"),
        "not-a-jwt",
    ],
    ids=["signature", "expired", "audience", "issuer", "no-sub", "garbage"],
)
def test_an_unverifiable_token_is_401(bad: str):
    with pytest.raises(Auth.exceptions.HTTPException) as raised:
        user_for(f"Bearer {bad}", POLICY, our_key)
    assert raised.value.status_code == 401


def test_a_verified_token_from_elsewhere_is_403():
    with pytest.raises(Auth.exceptions.HTTPException) as raised:
        user_for(f"Bearer {token(organization_id='org-2')}", POLICY, our_key)
    assert raised.value.status_code == 403
    assert "organization" in str(raised.value.detail)


def test_the_policy_comes_from_settings(env):
    assert policy_of(ServerSettings()) == AccessPolicy(None, None)
    env.setenv("OAUTH_CLIENT_ID", " chess-app ")
    env.setenv("ALLOWED_ORGANIZATION_ID", "")
    assert policy_of(ServerSettings()) == AccessPolicy("chess-app", None)


async def test_the_handler_checks_against_settings_and_langsmith_keys(env, monkeypatch):
    env.setenv("OAUTH_CLIENT_ID", "chess-app")
    env.setenv("ALLOWED_ORGANIZATION_ID", "org-1")
    auth_module._policy.cache_clear()
    looked_up: list[str] = []

    class FakeJwks:
        def get_signing_key_from_jwt(self, jwt_token: str) -> Any:
            looked_up.append(jwt_token)
            return jwt.PyJWK.from_dict(OKPAlgorithm.to_jwk(KEY.public_key(), as_dict=True))

    monkeypatch.setattr(auth_module, "_jwks", FakeJwks)
    try:
        signed = token()
        assert await authenticate(f"Bearer {signed}") == {"identity": "user-1"}
        assert looked_up == [signed]
    finally:
        auth_module._policy.cache_clear()


def test_keys_come_from_langsmith():
    auth_module._jwks.cache_clear()
    assert auth_module._jwks().uri == JWKS_URL
