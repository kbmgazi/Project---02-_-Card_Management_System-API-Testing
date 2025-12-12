# 💳 Card Management System — API Testing (E2E QA)

This repository contains end-to-end API testing resources and supporting mock servers for the Card Management System (CMS) project.

## 🛠️ Contents

* **[`mock-server`](mock-server)**: Lightweight Express-based mock endpoints used during API testing to simulate CMS services.
* **[`postman/CMS API.postman_collection.json`](postman/CMS%20API.postman_collection.json)**: Postman collection for manual API exploration and smoke tests.
* **[`sql`](sql)**: Database schema and related helpers used by automated tests.
* **[`tests`](tests)**: Automated test suites and test management artifacts.
* **[`docs/Test Logs`](docs/Test%20Logs)**: Folders with recorded test logs and artifacts from previous runs.

---

## ✅ Prerequisites

To set up and run the tests and mock servers, you will need:

* **Node.js (v16+)** and **npm** installed.
* *Optional:* **MySQL server** if you run tests that require interaction with a real database.

## 🚀 Quick Setup

1.  **Clone the repository:**

    ```powershell
    git clone [https://github.com/kbmgazi/Project---02-_-Card_Management_System-API-Testing.git](https://github.com/kbmgazi/Project---02-_-Card_Management_System-API-Testing.git)
    cd Project---02-_-Card_Management_System-API-Testing
    ```

2.  **Install mock server dependencies:**

    ```powershell
    cd mock-server
    npm install
    ```

3.  **(Optional) Install SQL helper dependencies:**

    ```powershell
    cd ..\sql
    npm install
    ```

---

## 🏃 Running the Mock Server Modules

The `mock-server` directory contains several small Node.js modules that emulate specific CMS APIs (e.g., Authorization, Card Creation, etc.).

There is no central launcher script; you must run the specific mock module(s) required for your tests using Node.

### Examples:

```powershell
node mock-server/authorisation.js
node mock-server/CardCreate.js
node mock-server/dataManagement.js
node mock-server/pinManagement.js
