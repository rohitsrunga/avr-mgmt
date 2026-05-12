import json
from decimal import Decimal


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Content-Type": "application/json",
}


class _DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == o.to_integral_value() else float(o)
        return super().default(o)


def _build(status, body):
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=_DecimalEncoder) if body is not None else "",
    }


def ok(body):
    return _build(200, body)


def created(body):
    return _build(201, body)


def no_content():
    return _build(204, None)


def bad_request(message):
    return _build(400, {"error": message})


def unauthorized(message="Unauthorized"):
    return _build(401, {"error": message})


def forbidden(message="Forbidden"):
    return _build(403, {"error": message})


def not_found(message="Not found"):
    return _build(404, {"error": message})


def server_error(message="Internal server error"):
    return _build(500, {"error": message})
