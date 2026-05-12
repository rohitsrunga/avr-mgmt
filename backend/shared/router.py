import json
import re


class Router:
    """Tiny URL router for Lambda proxy events.

    Register handlers for METHOD + path patterns. Path params use {name} syntax.
    """

    def __init__(self):
        self._routes = []

    def add(self, method, pattern, handler):
        regex = re.sub(r"\{([^}]+)\}", r"(?P<\1>[^/]+)", pattern)
        self._routes.append((method.upper(), re.compile(f"^{regex}$"), handler))

    def get(self, pattern):
        def deco(fn):
            self.add("GET", pattern, fn)
            return fn

        return deco

    def post(self, pattern):
        def deco(fn):
            self.add("POST", pattern, fn)
            return fn

        return deco

    def put(self, pattern):
        def deco(fn):
            self.add("PUT", pattern, fn)
            return fn

        return deco

    def delete(self, pattern):
        def deco(fn):
            self.add("DELETE", pattern, fn)
            return fn

        return deco

    def dispatch(self, event):
        method = (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
        path = event.get("rawPath") or event.get("requestContext", {}).get("http", {}).get("path") or ""
        if method == "OPTIONS":
            from .response import no_content
            return no_content()
        for route_method, regex, handler in self._routes:
            if route_method != method:
                continue
            m = regex.match(path)
            if m:
                return handler(event, m.groupdict())
        from .response import not_found
        return not_found(f"No route for {method} {path}")


def parse_body(event):
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body).decode("utf-8")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def query_params(event):
    return event.get("queryStringParameters") or {}
