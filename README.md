# Holiday Message Verification Platform

A local web app for support engineers to verify holiday messages across multiple CUs (Credit Unions). Select one, several, or all customers and a date; the app runs the same POST request you use in Postman for each selected CU and shows whether the holiday message played and the call did not transfer to the agent.

## Prerequisites

- Node.js (v16 or later)
- Your Excel file with customer names and mock API URLs

## Setup

1. Place your Excel file in the project root and name it **`postman api.xlsx`**.

2. Excel format:
   - **Column 1 (or column with "name" / "customer" / "cu" in the header):** Customer/CU name.
   - **Column 2 (or column with "url" / "mock" / "link" in the header):** Full mock URL, including `/admin/mock` (e.g. `https://communication-aicc-uat-bot.interface.ai/admin/mock`).
   - First row is treated as the header; data starts from the second row.

3. Install dependencies and start the server:

   ```bash
   npm install
   npm start
   ```

4. Open **http://localhost:3000** in your browser.

5. **Bearer token:** Copy `bearer-token.example.txt` to `bearer-token.txt` and paste your API token on the first line. The app uses it for all verification requests.

## Usage

1. **Holiday date** – Choose the date you want to test (e.g. the US holiday).
2. **Customers** – Use "Select all" or tick individual CUs.
3. **Run verification** – Click the button. The app will POST to each selected CU’s mock URL with that date and the same body as in Postman.
4. **Results** – A table shows for each CU: status (Pass/Fail), whether the holiday message was found, whether the call was transferred to an agent, and a short details message.

## API (used by the UI)

- **GET /api/customers** – Returns the list of customers from the Excel file (names only).
- **POST /api/run** – Body: `{ "date": "YYYY-MM-DD", "customerNames": ["CU A", "CU B", ...] }`. Runs verification for each name and returns results.

## Port

The server runs on port **3000** by default. To use another port, set the `PORT` environment variable (e.g. `PORT=4000 npm start`).
