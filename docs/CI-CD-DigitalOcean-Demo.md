# CI/CD Pipeline – DigitalOcean Demo

## 1. Overview

This repository demonstrates a simple end-to-end CI/CD pipeline for a Node.js application deployed to a DigitalOcean droplet.

**Goals:**

- Run automated build and tests on every push.
- If tests succeed on the `staging` branch → deploy to the **staging environment** on the droplet.
- If tests succeed on the `main` branch → deploy to the **production environment** on the droplet.
- Deploy using SSH from GitHub Actions to the DigitalOcean VM.
- Enforce basic security hardening and least-privilege principles on the target server.

Target droplet (test environment):

- Host: `138.68.100.120`
- User: `deploy` (non-root deployment user)
- Platform: DigitalOcean droplet (Ubuntu/compatible Linux).


## 2. Repository Structure

Minimal relevant structure:

- `src/server.js` – HTTP server implementation.
- `test/sanity.test.js` – Simple logic test used to gate deployments.
- `test/server.test.js` – Integration test that starts the HTTP server and validates responses.
- `package.json` – Node.js project configuration and scripts.
- `.github/workflows/ci-cd.yml` – GitHub Actions workflow implementing CI/CD.

Example layout:

- `digitalocean-demo/`  
  - `src/`  
    - `server.js`  
  - `test/`  
    - `sanity.test.js`  
    - `server.test.js`  
  - `package.json`  
  - `.github/`  
    - `workflows/`  
      - `ci-cd.yml`  


## 3. Application Code

### 3.1 `src/server.js`

A basic HTTP server that returns a message based on the environment variable `ENV_MESSAGE`. If the variable is not set, a default message is used.

The module exports the HTTP server instance so tests can require it without automatically starting a real listener. When executed directly (e.g., `node src/server.js`), it listens on port `3000`.

```js
// src/server.js
const http = require("http");

const message = process.env.ENV_MESSAGE || "No environment message set!";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(message);
});

// Only listen if this file is run directly
if (require.main === module) {
  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

module.exports = server;
```

This file is shared between staging and production, but each environment sets a different `ENV_MESSAGE` when starting the server from the CI/CD pipeline.


## 4. Node.js Project Configuration

### 4.1 `package.json`

Minimal configuration to run the server, build (runtime check) and tests.

```json
{
  "name": "digitalocean-demo",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "build": "node -e \"require('./src/server.js')\"",
    "test": "npm run build && node test/sanity.test.js && node test/server.test.js",
    "start": "node src/server.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": ""
}
```

Key points:

- `build` runs `node -e "require('./src/server.js')"`:
  - This executes the top-level code in `server.js` and fails if there are any runtime errors when loading the module (e.g., stray identifiers like `sds`, bad imports, etc.).
- `test` runs:
  1. `npm run build` (runtime load check of `server.js`).
  2. `node test/sanity.test.js` (simple logic test).
  3. `node test/server.test.js` (integration test hitting the HTTP server).
- `start` runs the application server on port `3000` for real use.


## 5. Tests

### 5.1 `test/sanity.test.js`

A simple test using Node’s built-in `assert` module, used mainly as a demonstration that failing tests stop deployments.

```js
// test/sanity.test.js
const assert = require("assert");

function add(a, b) {
  return a + b;
}

// Passing test
assert.strictEqual(add(1, 1), 2, "add(1, 1) should equal 2");

console.log("Sanity test passed!");
```

If this test fails (for example by changing `2` to `3`), the CI job will fail and **no deployment** will occur. This is useful for demonstrating that deployments are gated by tests.


### 5.2 `test/server.test.js`

This is a minimal integration test that:

1. Starts the exported server on a test port (`4000`).
2. Sends an HTTP request to the root path (`/`).
3. Validates that the response body matches the expected message.
4. Closes the server so the process can exit cleanly.

```js
// test/server.test.js
const http = require("http");
const assert = require("assert");
const server = require("../src/server");

const PORT = 4000;

server.listen(PORT, () => {
  const options = {
    hostname: "127.0.0.1",
    port: PORT,
    path: "/",
    method: "GET"
  };

  const req = http.request(options, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      try {
        assert.strictEqual(
          data,
          "No environment message set!",
          `Unexpected response body: ${data}`
        );
        console.log("Server integration test passed");
      } catch (err) {
        console.error("Server integration test failed:", err.message);
        process.exitCode = 1;
      } finally {
        server.close();
      }
    });
  });

  req.on("error", (err) => {
    console.error("Request error:", err.message);
    process.exitCode = 1;
    server.close();
  });

  req.end();
});
```

With this test in place, runtime or logic errors inside the HTTP handler (e.g., stray identifiers like `sds` or `a` used inside the handler body) will cause the test to fail, preventing deployment.


## 6. Server Environments on the Droplet

On the DigitalOcean droplet, two separate directories are used to represent the two environments:

- `/opt/digitalocean-demo-staging` – deployment target for the `staging` branch.
- `/opt/digitalocean-demo-prod` – deployment target for the `main` branch.

The CI pipeline uses `rsync` over SSH to copy the repository contents into these directories and then restarts the Node.js process in each environment with the appropriate environment message.

Each directory is owned by the non-privileged `deploy` user to avoid requiring `sudo` during deployment.


## 7. SSH and Secrets Setup

To avoid passwords in CI, deployments use an SSH key pair:

1. Generate an SSH key pair locally (for GitHub Actions).
2. Add the public key to the `deploy` user’s `~/.ssh/authorized_keys` on the droplet.
3. Store the private key and connection details as GitHub Secrets.

Expected GitHub Secrets:

- `DO_HOST` – droplet IP, e.g. `138.68.100.120`.
- `DO_USER` – SSH user, set to `deploy`.
- `DO_SSH_KEY` – contents of the private SSH key used by GitHub Actions.

These secrets are injected as environment variables in the workflow and used to run `ssh` and `rsync` commands securely from GitHub’s runners.


## 8. CI/CD Workflow (GitHub Actions)

The CI/CD pipeline is defined in `.github/workflows/ci-cd.yml`.

### 8.1 Triggers

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

### 8.2 Jobs Overview

The workflow defines three jobs:

1. `build-and-test` – common job that runs on both branches.
   - Checks out code.
   - Installs dependencies.
   - Runs `npm test` (which internally runs `npm run build` and both test files).
2. `deploy-staging` – runs only when branch is `staging` and tests succeed.
   - Deploys to `/opt/digitalocean-demo-staging`.
   - Starts the server with an environment message for staging.
3. `deploy-prod` – runs only when branch is `main` and tests succeed.
   - Deploys to `/opt/digitalocean-demo-prod`.
   - Starts the server with an environment message for production.


### 8.3 `build-and-test` Job

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

      - name: Run tests (build + tests)
        run: npm test
```

Because `npm test` runs the `build` script and both test files, this job now:

- Checks that `server.js` loads successfully at runtime.
- Runs a simple logic test (`sanity.test.js`).
- Starts the HTTP server on a test port and validates the response (`server.test.js`).

If any of these steps fail, this job fails and GitHub Actions will **not** run the dependent deployment jobs.


### 8.4 `deploy-staging` Job

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
            pkill -u deploy node || true
            ENV_MESSAGE="Hello from STAGING!" nohup node src/server.js > app.log 2>&1 &
          EOF
```

Notes:

- `needs: build-and-test` ensures that deployment only happens **after** all build and test steps pass.
- `if: github.ref == 'refs/heads/staging'` restricts this job to the `staging` branch.
- The server is started in the background with `nohup` and logs to `app.log`.
- `ENV_MESSAGE` is set to `"Hello from STAGING!"` for easy verification.
- `pkill -u deploy node` ensures only Node processes owned by `deploy` are killed before restart.


### 8.5 `deploy-prod` Job

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
            pkill -u deploy node || true
            ENV_MESSAGE="Hello from PROD!" nohup node src/server.js > app.log 2>&1 &
          EOF
```

Notes:

- Similar to staging, but deploys into `/opt/digitalocean-demo-prod`.
- Uses a different `ENV_MESSAGE` so that production can be distinguished from staging.


## 9. How the Build and Test Gate Works

1. A developer pushes changes to either `staging` or `main`.
2. GitHub Actions triggers the `build-and-test` job.
3. `npm test` runs the following in sequence:
   - `npm run build`: loads `src/server.js` at runtime, catching syntax and top-level runtime errors.
   - `node test/sanity.test.js`: basic logic test (e.g., `add(1, 1) === 2`).
   - `node test/server.test.js`: integration test that starts the HTTP server and validates the response.
4. If any of these steps fail:
   - `build-and-test` fails.
   - `deploy-staging` and `deploy-prod` are **not** executed.
5. If all steps pass:
   - For `staging`: the app is deployed and started with `"Hello from STAGING!"` as the HTTP response message.
   - For `main`: the app is deployed and started with `"Hello from PROD!"` as the HTTP response message.

This ensures that:

- The code parses correctly.
- The server module loads successfully at runtime.
- The request handler returns the expected response in a real HTTP request.

Only then is deployment allowed.


## 10. Manual Verification

- After a successful `staging` deployment, open:  
  `http://138.68.100.120:3000`  
  You should see the staging message in the response body.

- After merging changes into `main` and pushing, the production deployment will run. Once complete, the same URL should return the production message (`Hello from PROD!`) if the production process is running.


## 11. Security Hardening: Least-Privilege Deploy User

To avoid running the application and deployments as `root`, the CI/CD pipeline was hardened by introducing a dedicated non-privileged `deploy` user.

### 11.1 Deploy User

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

This allows the CI/CD pipeline to run `npm install`, start the Node.js server, and manage logs **without** requiring sudo.


### 11.2 Removing Root-Equivalent Sudo Access

By default, Ubuntu grants full sudo privileges to members of the `sudo` group via:

```text
%sudo ALL=(ALL:ALL) ALL
```

Initially, `deploy` belonged to the `sudo` group, which effectively made it equivalent to root. To enforce least privilege, `deploy` was removed from the `sudo` group:

```bash
sudo deluser deploy sudo
```

(Alternatively: `sudo gpasswd -d deploy sudo`.)

After this change:

- `deploy` can no longer run arbitrary commands as root.
- `sudo -l` for `deploy` confirms that it is not in the sudoers file.
- The CI/CD pipeline still functions correctly because all deployment actions (file sync, `npm install`, starting the Node.js server on port 3000) occur inside directories owned by `deploy` and do not require elevated privileges.

This setup ensures that even if the CI credentials are compromised, the attacker only gains access to a non-privileged deploy user rather than full root access on the server.