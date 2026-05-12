"""Interactive Cloudbeds OAuth setup for Saco Bay.

This script:
  1. Prompts you to enter client_id, client_secret, and api_key.
  2. Opens your browser for the OAuth authorization code flow.
  3. Exchanges the code for an access_token and refresh_token.
  4. Stores everything in AWS Secrets Manager (avr-mgmt/cloudbeds/saco_bay).

Run locally; never commit credentials. The temporary localhost server
listens on port 8765 to receive the OAuth redirect.

Usage:
    python3 scripts/cloudbeds_oauth_setup.py --stack avr-mgmt --region us-east-1
"""
import argparse
import getpass
import http.server
import json
import socketserver
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

import boto3


REDIRECT_URI = "http://localhost:8765/callback"
AUTH_URL = "https://hotels.cloudbeds.com/api/v1.1/oauth"
TOKEN_URL = "https://hotels.cloudbeds.com/api/v1.1/access_token"
SCOPE = "read:reservation read:guest read:dashboard read:room read:transaction"


_received = {"code": None, "error": None}


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        pass  # silence

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        qs = urllib.parse.parse_qs(parsed.query)
        if "error" in qs:
            _received["error"] = qs["error"][0]
        elif "code" in qs:
            _received["code"] = qs["code"][0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>You can close this window.</h1>")


def run_local_server(timeout=300):
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", 8765), _Handler)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _received["code"] or _received["error"]:
            break
        httpd.handle_request()
    httpd.server_close()


def exchange_code(client_id, client_secret, code):
    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT_URI,
        "code": code,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", default="avr-mgmt")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--property", default="saco_bay",
                        choices=["saco_bay"])  # only Saco Bay uses Cloudbeds
    args = parser.parse_args()

    print("Cloudbeds OAuth setup")
    print("=" * 60)
    print(f"Property: {args.property}")
    print(f"Redirect URI to register in Cloudbeds developer portal:")
    print(f"  {REDIRECT_URI}")
    print()

    client_id = input("client_id: ").strip()
    client_secret = getpass.getpass("client_secret: ").strip()
    api_key = getpass.getpass("api_key (optional, press Enter to skip): ").strip()

    if not client_id or not client_secret:
        print("ERROR: client_id and client_secret required.", file=sys.stderr)
        sys.exit(1)

    auth_query = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
    })
    auth_url = f"{AUTH_URL}?{auth_query}"
    print(f"\nOpening browser to: {auth_url}\n")

    server_thread = threading.Thread(target=run_local_server, daemon=True)
    server_thread.start()
    webbrowser.open(auth_url)
    server_thread.join(timeout=300)

    if _received["error"]:
        print(f"OAuth error: {_received['error']}", file=sys.stderr)
        sys.exit(1)
    if not _received["code"]:
        print("Did not receive authorization code (timeout?).", file=sys.stderr)
        sys.exit(1)

    print("Got authorization code, exchanging for tokens...")
    tokens = exchange_code(client_id, client_secret, _received["code"])
    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    if not refresh_token:
        print(f"ERROR: no refresh_token in response: {tokens}", file=sys.stderr)
        sys.exit(1)

    secret_payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "access_token": access_token,
        "api_key": api_key,
    }
    secret_name = f"{args.stack}/cloudbeds/{args.property}"
    secrets_client = boto3.client("secretsmanager", region_name=args.region)
    secrets_client.put_secret_value(
        SecretId=secret_name,
        SecretString=json.dumps(secret_payload),
    )
    print()
    print(f"Stored credentials in Secrets Manager: {secret_name}")
    print("Cloudbeds sync will now pick these up on its next run (every 6 hours).")


if __name__ == "__main__":
    main()
