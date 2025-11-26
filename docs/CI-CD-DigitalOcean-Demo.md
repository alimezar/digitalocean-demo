# CI/CD Pipeline – DigitalOcean Demo

## 1. Overview

This repository demonstrates a simple end-to-end CI/CD pipeline for a Node.js application deployed to a DigitalOcean droplet.

**Goals:**

- Run automated build and tests on every push.
- If tests succeed on the `staging` branch → deploy to the **staging environment** on the droplet.
- If tests succeed on the `main` branch → deploy to the **production environment** on the droplet.
- Deploy using SSH from GitHub Actions to the DigitalOcean VM.

Target droplet (test environment):

- Host: 138.68.100.120
- User: root / deploy (see security hardening section)
- Platform: DigitalOcean droplet (Ubuntu/compatible Linux).


## 2. Repository Structure

Minimal relevant structure:

- `src/server.js` – HTTP server implementation.
- `test/sanity.test.js` – Very simple Node.js test used to gate deployments.
- `package.json` – Node.js project configuration and scripts.
- `.github/workflows/ci-cd.yml` – GitHub Actions workflow implementing CI/CD.

Example layout:

- digitalocean-demo/
  - src/
    - server.js
  - test/
    - sanity.test.js
  - package.json
  - .github/
    - workflows/
      - ci-cd.yml


## 3. Application Code

### 3.1 `src/server.js`

A basic HTTP server that returns a message based on the environment variable `ENV_MESSAGE`. If the variable is not set, a default message is used.

```js
const http = require("http");

const message = process.env.ENV_MESSAGE || "No environment message set!";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(message);
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
```

This file is shared between staging and production, but each environment sets a different `ENV_MESSAGE` when starting the server from the CI/CD pipeline.


### 3.2 `package.json`

Minimal configuration to run the server and tests.

```json
{
  "name": "digitalocean-demo",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node test/sanity.test.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": ""
}
```

Key points:

- `start` runs the HTTP server.
- `test` runs a simple Node script to validate basic logic. This is what CI uses to decide whether to deploy.


### 3.3 `test/sanity.test.js`

A simple test using Node’s built-in `assert` module.

```js
const assert = require("assert");

function add(a, b) {
  return a + b;
}

// Passing test
assert.strictEqual(add(1, 1), 2, "add(1, 1) should equal 2");

console.log("All tests passed!");
```

If this test fails (for example by changing `2` to `3`), the CI job will fail and **no deployment** will occur. This is useful for demonstrating that deployments are gated by tests.


## 4. Server Environments on the Droplet

On the DigitalOcean droplet, we use two separate directories to represent the two environments:

- `/opt/digitalocean-demo-staging` – deployment target for the `staging` branch.
- `/opt/digitalocean-demo-prod` – deployment target for the `main` branch.

The CI pipeline uses `rsync` over SSH to copy the repository contents into these directories and then restarts the Node.js process in each environment with the appropriate environment message.


## 5. SSH and Secrets Setup

To avoid passwords in CI, deployments use an SSH key pair:

1. Generate an SSH key pair locally (for GitHub Actions).
2. Add the public key to `/root/.ssh/authorized_keys` on the droplet.
3. Store the private key and connection details as GitHub Secrets.

Expected GitHub Secrets:

- `DO_HOST` – droplet IP, e.g. `138.68.100.120`.
- `DO_USER` – SSH user, e.g. `deploy`.
- `DO_SSH_KEY` – contents of the private SSH key used by GitHub Actions.

These secrets are injected as environment variables in the workflow and used to run `ssh` and `rsync` commands securely from GitHub’s runners.


## 6. CI/CD Workflow (GitHub Actions)

The CI/CD pipeline is defined in `.github/workflows/ci-cd.yml`.

### 6.1 Triggers

The workflow runs on:

- Every `push` to `staging`.
- Every `push` to `main`.

```yaml
on:
  push:
    branches:
      - staging
      - main
```

### 6.2 Jobs Overview

The workflow defines three jobs:

1. `build-and-test` – common job that runs on both branches.
   - Checks out code.
   - Installs dependencies.
   - Runs tests.
2. `deploy-staging` – runs only when branch is `staging` and tests succeed.
   - Deploys to `/opt/digitalocean-demo-staging`.
   - Starts the server with an environment message for staging.
3. `deploy-prod` – runs only when branch is `main` and tests succeed.
   - Deploys to `/opt/digitalocean-demo-prod`.
   - Starts the server with an environment message for production.


### 6.3 `build-and-test` Job

```yaml
jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test
```

If `npm test` fails, this job fails and GitHub Actions will **not** run the dependent deployment jobs.


### 6.4 `deploy-staging` Job

```yaml
  deploy-staging:
    needs: build-and-test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/staging'

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Copy files to staging server
        env:
          DO_HOST: ${{ secrets.DO_HOST }}
          DO_USER: ${{ secrets.DO_USER }}
          DO_SSH_KEY: ${{ secrets.DO_SSH_KEY }}
        run: |
          echo "$DO_SSH_KEY" > do_key
          chmod 600 do_key

          rsync -avz --delete             -e "ssh -i do_key -o StrictHostKeyChecking=no"             ./ $DO_USER@$DO_HOST:/opt/digitalocean-demo-staging

      - name: Restart staging app
        env:
          DO_HOST: ${{ secrets.DO_HOST }}
          DO_USER: ${{ secrets.DO_USER }}
          DO_SSH_KEY: ${{ secrets.DO_SSH_KEY }}
        run: |
          echo "$DO_SSH_KEY" > do_key
          chmod 600 do_key

          ssh -i do_key -o StrictHostKeyChecking=no $DO_USER@$DO_HOST << 'EOF'
            cd /opt/digitalocean-demo-staging
            npm install
            pkill node || true
            ENV_MESSAGE="Hello from STAGING!" nohup node src/server.js > app.log 2>&1 &
          EOF
```

Notes:

- `needs: build-and-test` ensures that deployment only happens **after** tests pass.
- `if: github.ref == 'refs/heads/staging'` restricts this job to the `staging` branch.
- The server is started in the background with `nohup` and logs to `app.log`.
- `ENV_MESSAGE` is set to `"Hello from STAGING!"` for easy verification.


### 6.5 `deploy-prod` Job

```yaml
  deploy-prod:
    needs: build-and-test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Copy files to prod server
        env:
          DO_HOST: ${{ secrets.DO_HOST }}
          DO_USER: ${{ secrets.DO_USER }}
          DO_SSH_KEY: ${{ secrets.DO_SSH_KEY }}
        run: |
          echo "$DO_SSH_KEY" > do_key
          chmod 600 do_key

          rsync -avz --delete             -e "ssh -i do_key -o StrictHostKeyChecking=no"             ./ $DO_USER@$DO_HOST:/opt/digitalocean-demo-prod

      - name: Restart prod app
        env:
          DO_HOST: ${{ secrets.DO_HOST }}
          DO_USER: ${{ secrets.DO_USER }}
          DO_SSH_KEY: ${{ secrets.DO_SSH_KEY }}
        run: |
          echo "$DO_SSH_KEY" > do_key
          chmod 600 do_key

          ssh -i do_key -o StrictHostKeyChecking=no $DO_USER@$DO_HOST << 'EOF'
            cd /opt/digitalocean-demo-prod
            npm install
            pkill node || true
            ENV_MESSAGE="Hello from PROD!" nohup node src/server.js > app.log 2>&1 &
          EOF
```

Notes:

- Similar to staging, but deploys into `/opt/digitalocean-demo-prod`.
- Uses a different `ENV_MESSAGE` so that production can be distinguished from staging.


## 7. How the Test Gate Works

1. A developer pushes changes to either `staging` or `main`.
2. GitHub Actions triggers the `build-and-test` job.
3. `npm test` runs `test/sanity.test.js`:
   - If the test passes: CI step succeeds, CI/CD continues.
   - If the test fails: CI step fails, `deploy-staging` and `deploy-prod` are **not** executed.
4. When tests pass:
   - For `staging`: the app is deployed and started with `"Hello from STAGING!"` as the HTTP response message.
   - For `main`: the app is deployed and started with `"Hello from PROD!"` as the HTTP response message.

### Example: Forcing a Failure

To demonstrate failure behavior, you can temporarily modify the assertion in `sanity.test.js`:

```js
assert.strictEqual(add(1, 1), 3, "add(1, 1) should equal 3");
```

Pushing this change will cause:

- `build-and-test` to fail.
- `deploy-staging` and `deploy-prod` to be skipped, proving that deployments are gated by tests.


## 8. Manual Verification

- After a successful `staging` deployment, open:  
  `http://138.68.100.120:3000`  
  You should see the staging message in the response body.

- After merging changes into `main` and pushing, the production deployment will run. Once complete, the same URL should return the production message (`Hello from PROD!"`) if the production process is running.

## Security Hardening: Least-Privilege Deploy User

To avoid running the application and deployments as `root`, the CI/CD pipeline was hardened by introducing a dedicated non-privileged **deploy** user.

### Deploy User

A separate Unix user named `deploy` is used exclusively for application deployments:

- GitHub Actions connects to the server as `deploy` via SSH key-based authentication.
- The application code is deployed into:
  - `/opt/digitalocean-demo-staging`
  - `/opt/digitalocean-demo-prod`
- These directories are owned by `deploy`:

```bash
sudo mkdir -p /opt/digitalocean-demo-staging /opt/digitalocean-demo-prod
sudo chown -R deploy:deploy /opt/digitalocean-demo-staging /opt/digitalocean-demo-prod
```

This allows the CI/CD pipeline to run `npm install`, start the Node.js server, and manage logs without requiring sudo.

### Removing Root-Equivalent Sudo Access

By default, Ubuntu grants full sudo privileges to members of the `sudo` group via:

```text
%sudo ALL=(ALL:ALL) ALL
```

Initially, `deploy` belonged to the `sudo` group, which effectively made it equivalent to root. To enforce least privilege, `deploy` was removed from the `sudo` group:

```bash
sudo deluser deploy sudo
```

(Alternatively: `sudo gpasswd -d deploy sudo`.)

After this change, `deploy` can no longer run arbitrary commands as root, and `sudo -l` confirms that it is not in the sudoers file. The CI/CD pipeline still functions correctly because all deployment actions (file sync, `npm install`, starting the Node.js server on port 3000) occur inside directories owned by `deploy` and do not require elevated privileges.

This setup ensures that even if the CI credentials are compromised, the attacker only gains access to a non-privileged deploy user rather than full root access on the server.