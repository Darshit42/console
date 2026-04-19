# KubeStellar Console Installation Runbook

This runbook guides you through the installation of the KubeStellar Console on a Kubernetes cluster. You can execute these steps interactively if you are using [Runme](https://runme.dev/).

## Prerequisites

Ensure you have cluster-admin access to the target Kubernetes cluster and that standard tools are available.

```bash {name=check-prereqs}
# Verify kubectl connection and privileges
kubectl cluster-info
kubectl auth can-i '*' '*'

# Verify Helm is installed
helm version
```

## Step 1: Add Helm Repository

Add the official KubeStellar Console Helm repository.

```bash {name=add-helm-repo}
helm repo add kubestellar-console https://kubestellar.github.io/console
helm repo update kubestellar-console
```

## Step 2: Create Namespace

Create a dedicated namespace for the KubeStellar Console.

```bash {name=create-namespace}
kubectl create namespace kubestellar-console --dry-run=client -o yaml | kubectl apply -f -
```

## Step 3: Configure Parameters

Create a values file with any specific configurations required for your environment (e.g., Ingress, OAuth, Claude API Key). If installing locally for evaluation, the defaults without a values file work fine.

```bash {name=create-values}
cat <<'EOF' > custom-values.yaml
# Enable Claude AI Features (Optional)
# claude:
#   apiKey: "your-api-key"

# Enable GitHub OAuth (Optional)
# github:
#   clientId: "your-client-id"
#   clientSecret: "your-client-secret"
EOF
```

## Step 4: Install Console

Deploy the Helm chart to the cluster. This step configures the deployment and creates necessary services.

```bash {name=install-console}
# Standard installation
helm install kc kubestellar-console/kubestellar-console \
  --namespace kubestellar-console \
  --values custom-values.yaml \
  --wait --timeout 120s
```

## Step 5: Verify Deployment

Check the status of the KubeStellar Console pods to ensure they are running properly.

```bash {name=verify-deployment}
# Wait for pods to be ready (timeout after 90s)
if ! kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=kc -n kubestellar-console --timeout=90s; then
  echo "Timeout reached or pods failed to become ready."
  echo "Checking for CrashLoopBackOff or ImagePullBackOff..."
  kubectl get pods -n kubestellar-console | grep -E "CrashLoopBackOff|ImagePullBackOff|ErrImagePull" || true
  
  echo "Fetching logs for debugging:"
  kubectl logs -l app.kubernetes.io/instance=kc -n kubestellar-console --tail=50
  exit 1
fi

# Show pod status
kubectl get pods -n kubestellar-console
```

## Step 6: Access the Console

Forward the port to access the console locally, or fetch the Ingress/Route URL if you configured exposure options.

```bash {name=access-console}
# Run this in a separate terminal to keep the tunnel open
echo 'Connect to http://localhost:8080'
kubectl port-forward -n kubestellar-console svc/kc-kubestellar-console 8080:8080
```

## Uninstallation 

If you need to completely remove the installation, execute the uninstall command.

```bash {name=uninstall-console}
helm uninstall kc --namespace kubestellar-console
kubectl delete namespace kubestellar-console
```
