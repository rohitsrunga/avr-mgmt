"""Bootstrap the first owner user in the Cognito User Pool.

Usage:
    python3 scripts/setup_cognito.py --stack avr-mgmt --region us-east-1 \
        --email rohit_gazer@yahoo.com --name "Rohit Srungavarapu"

The script:
  1. Looks up the User Pool ID from the CloudFormation stack outputs.
  2. Creates the user with role=owner and property=both.
  3. Prints a generated temporary password to share with the user.
"""
import argparse
import secrets
import sys

import boto3


def generate_temp_password():
    upper = "ABCDEFGHJKMNPQRSTUVWXYZ"
    lower = "abcdefghjkmnpqrstuvwxyz"
    digits = "23456789"
    chars = upper + lower + digits
    pw = [secrets.choice(upper), secrets.choice(lower), secrets.choice(digits)]
    pw += [secrets.choice(chars) for _ in range(9)]
    secrets.SystemRandom().shuffle(pw)
    return "".join(pw)


def stack_output(cfn, stack_name, key):
    resp = cfn.describe_stacks(StackName=stack_name)
    for out in resp["Stacks"][0].get("Outputs", []):
        if out["OutputKey"] == key:
            return out["OutputValue"]
    raise RuntimeError(f"Output {key} not found on stack {stack_name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", default="avr-mgmt")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="")
    parser.add_argument("--role", default="owner",
                        choices=["owner", "manager", "frontdesk", "housekeeping", "grounds", "breakfast"])
    parser.add_argument("--property", default="both", choices=["casco_bay", "saco_bay", "both"])
    parser.add_argument("--password", default=None,
                        help="Optional: provide a specific temp password instead of generating")
    args = parser.parse_args()

    cfn = boto3.client("cloudformation", region_name=args.region)
    cognito = boto3.client("cognito-idp", region_name=args.region)

    pool_id = stack_output(cfn, args.stack, "UserPoolId")
    print(f"User Pool: {pool_id}")

    temp_password = args.password or generate_temp_password()

    try:
        cognito.admin_create_user(
            UserPoolId=pool_id,
            Username=args.email,
            UserAttributes=[
                {"Name": "email", "Value": args.email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "name", "Value": args.name or args.email},
                {"Name": "custom:role", "Value": args.role},
                {"Name": "custom:property", "Value": args.property},
            ],
            TemporaryPassword=temp_password,
            MessageAction="SUPPRESS",
        )
    except cognito.exceptions.UsernameExistsException:
        print(f"User {args.email} already exists. Resetting password...")
        cognito.admin_set_user_password(
            UserPoolId=pool_id,
            Username=args.email,
            Password=temp_password,
            Permanent=False,
        )

    print()
    print("=" * 60)
    print(f"  Email:           {args.email}")
    print(f"  Role:            {args.role}")
    print(f"  Property:        {args.property}")
    print(f"  Temp password:   {temp_password}")
    print("=" * 60)
    print()
    print("First sign-in will prompt for a permanent password.")


if __name__ == "__main__":
    main()
