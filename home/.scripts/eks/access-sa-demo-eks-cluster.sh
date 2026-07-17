#!/usr/bin/env bash
set -eu

REGION='us-west-1'
POLICY_ARN='arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy' # policy ARN we are giving ourselves on the cluster
PROFILE='SolutionsArchitecture/AWSAdministratorAccess'
OPAL_ASSET='c9c7c83b-7f27-4b43-81b3-ad5ba485e1bc'
REFRESH_THRESHOLD=600 # refresh creds if they expire within this many seconds (10 min)
PROPAGATION_TIMEOUT=180 # max seconds to wait for the JIT IAM role to propagate

export AWS_PAGER="" # disable taking over the terminal with the aws command output

usage() {
  cat <<EOF
Usage: $(basename "$0") [cluster] [--refresh]

  cluster   which cluster plain kubectl defaults to: sa-demo (default) | blue | green
            (full names tmprl-dem-cld-blue / tmprl-dem-cld-green also accepted)
  --refresh force a fresh Opal request + SSO login even if credentials are still valid

Every color is granted cluster-admin and registered as a kubectl context
(sa-demo, blue, green) on each run, so the context wrappers work after one auth:
  kubectl ...        -> the chosen default cluster
  bluekctl ...       -> kubectl --context blue
  greenkctl ...      -> kubectl --context green
  bluek9s / greenk9s -> k9s --context blue|green

Credentials are only refreshed when they are expired, expire within
$((REFRESH_THRESHOLD / 60)) minutes, or --refresh is passed.
EOF
}

# Clusters to configure, as "context-alias:eks-cluster-name". Every color is
# registered and granted on each run (missing ones are skipped), so the
# kubectl/k9s context wrappers (bluekctl, greenkctl, ...) always work after a
# single auth. The chosen cluster becomes plain kubectl's default context.
CLUSTERS='sa-demo:sa-demo blue:tmprl-dem-cld-blue green:tmprl-dem-cld-green'

# ---- parse args (cluster + flags, any order) --------------------------------
DEFAULT_ALIAS='sa-demo'
REFRESH=0
for arg in "$@"; do
  case "$arg" in
    --refresh|-r) REFRESH=1 ;;
    -h|--help)    usage; exit 0 ;;
    blue|tmprl-dem-cld-blue)   DEFAULT_ALIAS='blue' ;;
    green|tmprl-dem-cld-green) DEFAULT_ALIAS='green' ;;
    sa-demo|"")                DEFAULT_ALIAS='sa-demo' ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

# ---- credential freshness ---------------------------------------------------
# Ask the AWS CLI to resolve the profile's active credentials and print their
# expiry as epoch seconds. Fails if no valid credentials can be resolved (e.g.
# the SSO session has expired and cannot be refreshed non-interactively).
creds_expiry_epoch() {
  local iso
  iso=$(aws configure export-credentials --profile "$PROFILE" 2>/dev/null \
        | grep -o '"Expiration": *"[^"]*"' | cut -d'"' -f4)
  [ -n "$iso" ] || return 1
  # Strip the timezone/fractional suffix and parse as UTC (values are always Z/+00:00).
  date -j -u -f "%Y-%m-%dT%H:%M:%S" "${iso%%[+.Z]*}" +%s 2>/dev/null
}

need_refresh() {
  [ "$REFRESH" -eq 1 ] && { echo "--refresh requested."; return 0; }
  local exp now
  if ! exp=$(creds_expiry_epoch); then
    echo "No valid credentials found."
    return 0
  fi
  now=$(date +%s)
  if [ "$exp" -le $((now + REFRESH_THRESHOLD)) ]; then
    echo "Credentials expire within $((REFRESH_THRESHOLD / 60)) min (at $(date -r "$exp" '+%H:%M:%S'))."
    return 0
  fi
  echo "Credentials valid until $(date -r "$exp" '+%Y-%m-%d %H:%M:%S'); skipping refresh."
  return 1
}

# Poll until the just-granted JIT IAM role is usable, instead of a blind sleep.
wait_for_identity() {
  local deadline role
  deadline=$(( $(date +%s) + PROPAGATION_TIMEOUT ))
  echo "Waiting for IAM credentials to propagate..."
  while :; do
    if role=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null | cut -d/ -f2) \
       && [ -n "$role" ] \
       && aws iam get-role --role-name "$role" >/dev/null 2>&1; then
      echo "Credentials propagated (role: $role)."
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Timed out after ${PROPAGATION_TIMEOUT}s waiting for IAM credentials to propagate." >&2
      return 1
    fi
    sleep 3
  done
}

# ---- refresh credentials only when needed -----------------------------------
if need_refresh; then
  # Clear aws CLI credential cache
  rm -rf ~/.aws/sso/cache/* ~/.aws/cli/cache/*

  # Opal JIT request: creates a temporary IAM role for us
  opal request create --assets "$OPAL_ASSET"
  aws sso login
  wait_for_identity
fi

# ---- grant this session's role cluster-admin (always) -----------------------
# The SSO role ARN churns each session, so the access entry must be (re)granted
# every time we connect, regardless of whether we refreshed credentials.
ROLE_NAME=$(aws sts get-caller-identity --query Arn --output text | cut -d/ -f2)
PRINCIPAL_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

# Grant admin + register a friendly-named kubectl context for one cluster.
# Returns non-zero (without exiting the script) if the cluster doesn't exist.
configure_cluster() {
  local alias="$1" name="$2" err
  err=$(mktemp)

  if aws eks describe-cluster --region "$REGION" --name "$name" >/dev/null 2>&1; then :; else
    echo "  $alias ($name): not found, skipping."
    rm -f "$err"; return 1
  fi

  echo "  $alias ($name): granting cluster-admin to $PRINCIPAL_ARN"
  if aws eks create-access-entry \
        --region "$REGION" --cluster-name "$name" \
        --principal-arn "$PRINCIPAL_ARN" 2>"$err"; then
    :
  elif grep -q ResourceInUseException "$err"; then
    : # access entry already exists
  else
    cat "$err" >&2; rm -f "$err"; return 1
  fi
  rm -f "$err"

  aws eks associate-access-policy \
      --region "$REGION" --cluster-name "$name" \
      --principal-arn "$PRINCIPAL_ARN" \
      --policy-arn "$POLICY_ARN" \
      --access-scope type=cluster >/dev/null

  # --alias gives the context a short name (blue/green/sa-demo) for the wrappers.
  aws eks update-kubeconfig \
      --region "$REGION" --name "$name" --alias "$alias" >/dev/null
  echo "  $alias ($name): context ready."
  return 0
}

echo "Configuring clusters ($REGION):"
CONFIGURED=''
for entry in $CLUSTERS; do
  alias="${entry%%:*}"
  name="${entry#*:}"
  if configure_cluster "$alias" "$name"; then
    CONFIGURED="$CONFIGURED $alias"
  fi
done

# Point plain kubectl at the requested default (fall back to any configured one).
if printf '%s\n' $CONFIGURED | grep -qx "$DEFAULT_ALIAS"; then
  kubectl config use-context "$DEFAULT_ALIAS" >/dev/null
  echo "Default context -> $DEFAULT_ALIAS"
elif [ -n "$CONFIGURED" ]; then
  fallback="${CONFIGURED##* }"
  kubectl config use-context "$fallback" >/dev/null
  echo "Requested '$DEFAULT_ALIAS' unavailable; default context -> $fallback"
else
  echo "No clusters could be configured." >&2
  exit 1
fi

echo "Done. Try: kubectl get ns   |   bluekctl get ns   |   greenkctl get ns"
