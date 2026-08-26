#!/bin/bash
# Launch the API on a fresh EC2 instance.
#
#   ADMIN_TOKEN=$(openssl rand -hex 24) ./deploy/launch-ec2.sh
#   DOMAIN=api.example.com ./deploy/launch-ec2.sh     # provisions TLS for that name
#
# Creates a security group and one instance, waits for a public IP, and prints
# the next steps. Everything is tagged so teardown is a single command.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
NAME="${NAME:-linkedin-profile-api}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
DOMAIN="${DOMAIN:-}"
API_KEYS="${API_KEYS:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 24)}"
KEY_NAME="${KEY_NAME:-}"

echo "region        : $REGION"
echo "instance type : $INSTANCE_TYPE"
echo "domain        : ${DOMAIN:-<none, plain HTTP on :80>}"

# Amazon Linux 2023, resolved rather than hardcoded — AMI ids are per-region.
AMI_ID=$(aws ssm get-parameters --region "$REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)
echo "ami           : $AMI_ID"

VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=${NAME}-sg" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  echo "creating security group…"
  SG_ID=$(aws ec2 create-security-group --region "$REGION" \
    --group-name "${NAME}-sg" --vpc-id "$VPC_ID" \
    --description "HTTP/HTTPS for ${NAME}" --query 'GroupId' --output text)

  # 80 and 443 open to the world; 22 deliberately left closed — use SSM Session
  # Manager for shell access rather than exposing SSH.
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
fi
echo "security grp  : $SG_ID"

USER_DATA=$(mktemp)
{
  echo "#!/bin/bash"
  echo "export ADMIN_TOKEN='${ADMIN_TOKEN}'"
  echo "export API_KEYS='${API_KEYS}'"
  echo "export DOMAIN='${DOMAIN}'"
  tail -n +2 "$(dirname "$0")/cloud-init.sh"
} > "$USER_DATA"

RUN_ARGS=(
  --region "$REGION"
  --image-id "$AMI_ID"
  --instance-type "$INSTANCE_TYPE"
  --security-group-ids "$SG_ID"
  --user-data "file://$USER_DATA"
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}}]"
  --metadata-options "HttpTokens=required"
  --query 'Instances[0].InstanceId' --output text
)
[ -n "$KEY_NAME" ] && RUN_ARGS+=(--key-name "$KEY_NAME")

echo "launching…"
INSTANCE_ID=$(aws ec2 run-instances "${RUN_ARGS[@]}")
rm -f "$USER_DATA"
echo "instance      : $INSTANCE_ID"

aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
PUBLIC_IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

cat <<SUMMARY

  deployed
    instance   $INSTANCE_ID
    public IP  $PUBLIC_IP
    url        http://$PUBLIC_IP/

  ADMIN_TOKEN  $ADMIN_TOKEN
               (store this — it is the only way to seed or rotate the session)

  next
    1. bootstrap takes ~2 minutes. poll it:
         curl http://$PUBLIC_IP/v1/health

    2. point DNS at it, then re-run with DOMAIN set so Caddy issues a cert:
         A   api.yourdomain.com   ->   $PUBLIC_IP

    3. seed the LinkedIn session from your laptop (never from the server):
         ADMIN_TOKEN=$ADMIN_TOKEN npm run mint -- --push http://$PUBLIC_IP

  teardown
    aws ec2 terminate-instances --region $REGION --instance-ids $INSTANCE_ID

SUMMARY
