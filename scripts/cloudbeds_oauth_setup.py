"""Store the Cloudbeds property-level API key in AWS Secrets Manager.

Property-level integrations (Saco Bay) authenticate with a permanent
`cbat_…` API key sent as a Bearer token. There is no OAuth refresh — the
key only expires after 30 days of inactivity. This script reads the key
from .env and writes it to the secret the sync Lambda reads.

Setup:
  1. Generate an API key in the Cloudbeds dashboard
     (Settings → Apps & Marketplace → API Credentials) with scopes:
       read:dashboard  read:reservation  read:housekeeping
  2. Drop into .env at the repo root:
       api_key=cbat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
       client_id=…       # optional, retained for future partner OAuth
       client_secret=…   # optional
  3. Run:
       python3 scripts/cloudbeds_oauth_setup.py --region us-east-1

By default the script queries the deployed avr-sync Lambda for its
`CLOUDBEDS_SECRET_PREFIX` env var and uses that to derive the secret
name — so it always matches whatever StackPrefix the stack was deployed
with. Override with `--secret-prefix` for non-default setups.

Test:
  aws lambda invoke --function-name avr-sync --region us-east-1 /tmp/out.json \\
    && cat /tmp/out.json

Run locally; never commit credentials.
"""
import argparse
import json
import os
import sys

import boto3
from botocore.exceptions import ClientError


def _load_dotenv(path):
    """Tiny .env parser: KEY=VALUE per line, # comments, optional quotes."""
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip().lower()
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            out[k] = v
    return out


def _pick(env, *keys):
    for k in keys:
        v = env.get(k.lower())
        if v:
            return v
    return ""


def _derive_secret_prefix(lambda_name, region):
    """Ask the deployed sync Lambda which secret prefix it uses. This is
    the source of truth — the stack's StackPrefix parameter feeds the env
    var, and operators can override StackPrefix at deploy time."""
    lam = boto3.client("lambda", region_name=region)
    cfg = lam.get_function_configuration(FunctionName=lambda_name)
    return (cfg.get("Environment", {}).get("Variables", {}) or {}).get("CLOUDBEDS_SECRET_PREFIX")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--property", default="saco_bay", choices=["saco_bay"])
    parser.add_argument("--lambda-name", default="avr-sync",
                        help="Name of the deployed sync Lambda. Used to look up the secret prefix.")
    parser.add_argument("--secret-prefix", default=None,
                        help="Override the secret prefix (default: read from the Lambda's "
                             "CLOUDBEDS_SECRET_PREFIX env var). Final secret name is "
                             "<prefix>/<property>.")
    parser.add_argument("--env-file", default=".env",
                        help="Path to .env containing api_key (and optional client_id/client_secret).")
    args = parser.parse_args()

    env = _load_dotenv(args.env_file)
    api_key       = _pick(env, "api_key", "cloudbeds_api_key")
    client_id     = _pick(env, "client_id", "cloudbeds_client_id")
    client_secret = _pick(env, "client_secret", "cloudbeds_client_secret")

    if not api_key:
        print(f"ERROR: no `api_key` in {args.env_file}", file=sys.stderr)
        print("  Generate one in the Cloudbeds dashboard (Settings → Apps &", file=sys.stderr)
        print("  Marketplace → API Credentials). It will start with `cbat_`.", file=sys.stderr)
        sys.exit(1)
    if not api_key.startswith("cbat_"):
        print(f"WARN: api_key does not start with cbat_ — Cloudbeds property-level", file=sys.stderr)
        print(f"      keys always do. Double-check the value before relying on the sync.", file=sys.stderr)

    prefix = args.secret_prefix
    if not prefix:
        try:
            prefix = _derive_secret_prefix(args.lambda_name, args.region)
        except ClientError as e:
            print(f"ERROR: could not read env vars from Lambda {args.lambda_name}: {e}", file=sys.stderr)
            print("  Pass --secret-prefix to override, or deploy the stack first.", file=sys.stderr)
            sys.exit(1)
        if not prefix:
            print(f"ERROR: Lambda {args.lambda_name} has no CLOUDBEDS_SECRET_PREFIX env var.", file=sys.stderr)
            print("  Deploy the stack first, or pass --secret-prefix explicitly.", file=sys.stderr)
            sys.exit(1)

    payload = {
        "api_key":       api_key,
        "client_id":     client_id,
        "client_secret": client_secret,
    }
    secret_name = f"{prefix}/{args.property}"
    secrets_client = boto3.client("secretsmanager", region_name=args.region)
    # The stack normally creates this secret with placeholders, but if the
    # stack hasn't been deployed yet (or this is a fresh region) the secret
    # won't exist — create it on the fly so the script works either way.
    try:
        secrets_client.put_secret_value(
            SecretId=secret_name,
            SecretString=json.dumps(payload),
        )
        action = "updated"
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ResourceNotFoundException":
            raise
        secrets_client.create_secret(
            Name=secret_name,
            Description=f"Cloudbeds property-level API key for {args.property}",
            SecretString=json.dumps(payload),
        )
        action = "created"

    print(f"{action.capitalize()} Cloudbeds credentials for {args.property} in Secrets Manager:")
    print(f"  {secret_name}")
    print(f"  api_key: cbat_…{api_key[-6:]}")
    print()
    print("Invoke the sync Lambda now to verify:")
    print(f"  aws lambda invoke --function-name {args.lambda_name} --region {args.region} /tmp/out.json \\")
    print(f"    && cat /tmp/out.json")


if __name__ == "__main__":
    main()
