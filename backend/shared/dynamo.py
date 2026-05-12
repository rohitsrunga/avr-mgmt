import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

_dynamodb = boto3.resource("dynamodb")


def table(env_var):
    name = os.environ[env_var]
    return _dynamodb.Table(name)


def to_dynamo(value):
    """Convert Python values to DynamoDB-safe types."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def query_pk(tbl, pk_value, sk_prefix=None):
    """Query a table by partition key, optionally filtered by SK prefix."""
    cond = Key("PK").eq(pk_value)
    if sk_prefix:
        cond = cond & Key("SK").begins_with(sk_prefix)
    items = []
    kwargs = {"KeyConditionExpression": cond}
    while True:
        resp = tbl.query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def query_gsi(tbl, index_name, pk_attr, pk_value, sk_attr=None, sk_prefix=None):
    """Query a GSI by partition key, optionally filtered by SK prefix."""
    cond = Key(pk_attr).eq(pk_value)
    if sk_attr and sk_prefix:
        cond = cond & Key(sk_attr).begins_with(sk_prefix)
    items = []
    kwargs = {"IndexName": index_name, "KeyConditionExpression": cond}
    while True:
        resp = tbl.query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items
