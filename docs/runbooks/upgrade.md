# KubeStellar Console Upgrade Runbook

This runbook guides you through safely upgrading KubeStellar Console to a newer version. You can execute these steps interactively if you are using [Runme](https://runme.dev/).

## Prerequisites

Ensure you have cluster-admin access to the target Kubernetes cluster and that Helm is installed.

```bash {name=check-helm-release}
# Verify the current KubeStellar Console installation
helm list -n kubestellar-console

# Verify helm repository is up to date
helm repo update kubestellar-console
```

## Step 1: Pre-flight Verification

Before initiating the upgrade, check the health of the existing deployment and create an optional backup of your parameters.

```bash {name=pre-flight-verification}
# Check the health of current pods
kubectl get pods -n kubestellar-console

# Extract the currently deployed Helm values for backup
helm get values kc -n kubestellar-console > custom-values-backup.yaml
echo "Saved current values to custom-values-backup.yaml"
```

## Step 2: Determine Target Version

Search the Helm repository for available versions to select your target upgrade version.

```bash {name=search-versions}
# List available console versions
helm search repo kubestellar-console/kubestellar-console --versions
```

## Step 3: Upgrade Execution

Perform the rolling upgrade. You can pass the previous values file to ensure no custom settings (like API keys or OAuth configuration) are lost.

```bash {name=upgrade-console}
# Execute the upgrade (replace --version if you want a specific non-latest release)
helm upgrade kc kubestellar-console/kubestellar-console \
  --namespace kubestellar-console \
  --values custom-values-backup.yaml \
  --wait --timeout 120s
```

## Step 4: Verify Post-Upgrade

Validate that the new pods have successfully started and there are no crash loops.

```bash {name=verify-upgrade}
# Wait for pods to be ready (timeout after 90s)
if ! kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=kc -n kubestellar-console --timeout=90s; then
  echo "Timeout reached or pods failed to become ready during upgrade."
  echo "Checking for CrashLoopBackOff or ImagePullBackOff..."
  kubectl get pods -n kubestellar-console | grep -E "CrashLoopBackOff|ImagePullBackOff|ErrImagePull" || true
  
  echo "Fetching logs for debugging:"
  kubectl logs -l app.kubernetes.io/instance=kc -n kubestellar-console --tail=50
  
  echo "WARNING: Upgrade failed. Suggest executing the Rollback Procedure."
  exit 1
fi

# Verify the status and version of the deployment
helm history kc -n kubestellar-console
kubectl get pods -n kubestellar-console
```

## Rollback Procedure (In Case of Failure)

If the upgraded pods crash or fail readiness checks, you can instantly revert to the previous working state using Helm's rollback primitive.

```bash {name=rollback-console}
# View the revisions
helm history kc -n kubestellar-console

# Rollback to the previous revision (typically revision N-1)
# You can append the revision number at the end, e.g. `helm rollback kc 1 -n kubestellar-console`
helm rollback kc -n kubestellar-console
```
