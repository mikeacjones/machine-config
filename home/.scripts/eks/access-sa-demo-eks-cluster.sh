#!/bin/sh

REGION='us-west-1'
CLUSTER='sa-demo'
POLICY_ARN='arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy' # policy ARN we are giving ourselves on the cluster
PROFILE='SolutionsArchitecture/AWSAdministratorAccess'

export AWS_PAGER="" #disable taking over the termainl with the aws command output


# Clear aws CLI credential cache
rm -rf ~/.aws/sso/cache/*
rm -rf ~/.aws/cli/cache/*

# First create the Opal request;  this is a JIT request that creates a temporary IAM role for us
opal request create --assets c9c7c83b-7f27-4b43-81b3-ad5ba485e1bc
sleep 15s
aws sso login
sleep 5s
ROLE_NAME=$(aws sts get-caller-identity --query Arn --output text | cut -d/ -f2)

PRINCIPAL_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)\

echo "Granting cluster-admin on '$CLUSTER' ($REGION) to $PRINCIPAL_ARN"

if aws eks create-access-entry \
      --region "$REGION" --cluster-name "$CLUSTER" \
      --principal-arn "$PRINCIPAL_ARN" 2>/tmp/create-access-entry.err; then
  echo "Access entry created."
else
  if grep -q ResourceInUseException /tmp/create-access-entry.err; then
    echo "Access entry already exists, continuing."
  else
    cat /tmp/create-access-entry.err >&2
    exit 1
  fi
fi

aws eks associate-access-policy \
    --region "$REGION" --cluster-name "$CLUSTER" \
    --principal-arn "$PRINCIPAL_ARN" \
    --policy-arn "$POLICY_ARN" \
    --access-scope type=cluster

aws eks update-kubeconfig \
  --region us-west-1 \
  --name sa-demo \


echo "Done. Try: kubectl get ns"
