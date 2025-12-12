const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const app = express();
const PORT = 3000;

// --- Configuration ---
const BEARER_TOKEN = 'sk_test_xxxxxx'; // The expected valid token

// --- Middleware ---
app.use(express.json());
app.use(cors());

/**
 * Bearer Token Authentication Middleware
 * Checks for "Authorization: Bearer SECRET123" header.
 */
const authenticateBearer = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ success: false, error: "Authorization header missing." });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || token !== BEARER_TOKEN) {
        return res.status(401).json({ success: false, error: "Invalid or missing Bearer token." });
    }

    next();
};

// --- DB Connection Setup ---
let dbConnection;

// --- DB Helper Functions ---

/**
 * Finds a client record using the client_id.
 * @param {string} id - The client_id.
 * @returns {object|null} The client row or null.
 */
const findClient = async (id) => {
    // Select client_id and tax_number for the uniqueness check
    const [rows] = await dbConnection.query('SELECT client_id, tax_number FROM clients WHERE client_id = ?', [id]);
    return rows.length > 0 ? rows[0] : null;
};

/**
 * Checks if a tax number is already used by another client.
 * @param {string} taxNumber - The tax number to check.
 * @param {string} clientId - The ID of the current client (to exclude).
 * @returns {boolean} True if the tax number is unique or not provided, false otherwise.
 */
const isTaxNumberUnique = async (taxNumber, clientId) => {
    if (!taxNumber) return true;

    const [rows] = await dbConnection.query(
        'SELECT client_id FROM clients WHERE tax_number = ? AND client_id != ?',
        [taxNumber, clientId]
    );
    return rows.length === 0;
};

/**
 * Finds an account record using the account_number.
 * @param {string} accountNumber - The account number.
 * @returns {object|null} The account row or null.
 */
const findAccountByNumber = async (accountNumber) => {
    const [rows] = await dbConnection.query('SELECT account_number FROM accounts WHERE account_number = ?', [accountNumber]);
    return rows.length > 0 ? rows[0] : null;
};

/**
 * Finds a card record using the external_id (exid).
 * @param {string} exid - The card's external ID.
 * @returns {object|null} The card row or null.
 */
const findCardByExid = async (exid) => {
    // We select 'exid' for existence check and 'account_number' if needed for status sync logic
    const [rows] = await dbConnection.query('SELECT exid, account_number FROM cards WHERE exid = ?', [exid]);
    return rows.length > 0 ? rows[0] : null;
};

/**
 * Finds all card records associated with a given account number.
 * @param {string} accountNumber - The account number.
 * @returns {Array<object>} List of card records linked to the account.
 */
const findCardsByAccountNumber = async (accountNumber) => {
    const [rows] = await dbConnection.query('SELECT exid, status FROM cards WHERE account_number = ?', [accountNumber]);
    return rows;
};

// --- ROUTER SETUP ---

const updateRouter = express.Router();

// Apply Bearer authentication to all update routes
updateRouter.use(authenticateBearer);

// =======================================================
// 1. Client Update Endpoint
// Endpoint: POST /api/v1/update/updateClient
// =======================================================

updateRouter.post('/updateClient', async (req, res) => {
    const { client_id, name, surname, id_number, date_of_birth, gender, income, tax_number } = req.body;

    // Client ID is mandatory
    if (!client_id) {
        return res.status(400).json({ success: false, error: 'Client ID is mandatory for client update.' });
    }

    // Check for other required fields needed for a complete update
    if (!name || !surname || !id_number) {
        return res.status(400).json({ success: false, error: 'Missing mandatory fields (name, surname, id_number).' });
    }

    try {
        const client = await findClient(client_id);

        if (!client) {
            return res.status(404).json({ success: false, error: 'Client not found.' });
        }

        // Tax number uniqueness check
        if (tax_number && !await isTaxNumberUnique(tax_number, client_id)) {
            return res.status(400).json({ success: false, error: 'Tax number is already in use by another client.' });
        }

        // --- Execute Update Query ---
        const incomeValue = income ? parseFloat(income) : null; 

        await dbConnection.execute(
            `UPDATE clients 
             SET name = ?, surname = ?, id_number = ?, date_of_birth = ?, gender = ?, income = ?, tax_number = ?, updated_at = NOW() 
             WHERE client_id = ?`,
            [name, surname, id_number, date_of_birth, gender, incomeValue, tax_number, client_id]
        );

        return res.status(200).json({ success: true, message: 'Client updated successfully.', client_id });
    } catch (e) {
        console.error(`Client update error for ${client_id}:`, e.message);
        return res.status(500).json({ success: false, error: `Database or server error: ${e.message}` });
    }
});

// =======================================================
// 2. Account Update Endpoint (Contractual fields)
// Endpoint: POST /api/v1/update/updateAccountContract
// =======================================================

updateRouter.post('/updateAccountContract', async (req, res) => {
    const { account_number, product_code, dateOpened } = req.body;

    // MANDATORY FIELD CHECK: account_number
    if (!account_number) {
        return res.status(400).json({ success: false, error: 'Account number is mandatory for account update.' });
    }

    // Check for other required fields
    if (!product_code || !dateOpened) {
        return res.status(400).json({ success: false, error: 'Missing mandatory fields (product_code, dateOpened).' });
    }

    try {
        const account = await findAccountByNumber(account_number);

        if (!account) {
            return res.status(404).json({ success: false, error: 'Account not found.' });
        }

        // --- Execute Update Query against the 'accounts' table ---
        await dbConnection.execute(
            `UPDATE accounts 
             SET product_code = ?, date_opened = ?, updated_at = NOW() 
             WHERE account_number = ?`,
            [product_code, dateOpened, account_number]
        );

        return res.status(200).json({ success: true, message: 'Account updated successfully.', account_number });
    } catch (e) {
        console.error(`Account update error for ${account_number}:`, e.message);
        return res.status(500).json({ success: false, error: `Database or server error: ${e.message}` });
    }
});

// =======================================================
// 3. Card Update Endpoint (Contractual fields)
// Endpoint: POST /api/v1/update/updateCardContract
// =======================================================

updateRouter.post('/updateCardContract', async (req, res) => {
    const { exid, product_code, emboss_name, limit_amount } = req.body;

    // MANDATORY FIELD CHECK: exid
    if (!exid) {
        return res.status(400).json({ success: false, error: 'External ID (exid) is mandatory for card update.' });
    }

    // Check for other required fields
    if (!product_code) {
        return res.status(400).json({ success: false, error: 'Missing mandatory fields (product_code).' });
    }

    try {
        // Find the record using exid
        const card = await findCardByExid(exid);

        if (!card) {
            return res.status(404).json({ success: false, error: `Card details not found for External ID ${exid}.` });
        }
        
        // Ensure limit_amount is handled as a number
        const limitAmountValue = limit_amount ? parseFloat(limit_amount) : null; 

        // --- Execute Update Query against the 'cards' table ---
        await dbConnection.execute(
            `UPDATE cards 
             SET product_code = ?, emboss_name = ?, limit_amount = ?, updated_at = NOW() 
             WHERE exid = ?`,
            [product_code, emboss_name, limitAmountValue, exid]
        );

        return res.status(200).json({ success: true, message: 'Card details updated successfully.', exid });
    } catch (e) {
        console.error(`Card update error for ${exid}:`, e.message);
        return res.status(500).json({ success: false, error: `Database or server error: ${e.message}` });
    }
});

// =======================================================
// 4. Status Update Endpoint (Account or Card)
// Endpoint: POST /api/v1/update/updateStatus
// =======================================================

updateRouter.post('/updateStatus', async (req, res) => {
    const { 
        account_number,     
        exid,               
        new_status          
    } = req.body;

    // --- Validation ---
    const allowedStatuses = ['Active', 'Frozen', 'Closed'];
    if (!new_status || !allowedStatuses.includes(new_status)) {
        return res.status(400).json({ success: false, error: `Mandatory field new_status is invalid. Must be one of: ${allowedStatuses.join(', ')}.` });
    }
    
    if (!account_number && !exid) {
        return res.status(400).json({ success: false, error: 'Must provide either account_number or exid.' });
    }

    let connection;
    try {
        connection = await dbConnection.getConnection();
        await connection.beginTransaction();

        const updates = [];
        let accountUpdatePerformed = false;
        let cardUpdatePerformed = false;

        // 1. Handle Account Status Update and Card Synchronization
        if (account_number) {
            const accountUpdateResult = await connection.execute(
                `UPDATE accounts 
                 SET status = ?, updated_at = NOW() 
                 WHERE account_number = ?`,
                [new_status, account_number]
            );

            if (accountUpdateResult[0].affectedRows > 0) {
                accountUpdatePerformed = true;
                updates.push(`Account ${account_number} updated to ${new_status}.`);

                // Synchronize all linked cards to the same status
                const [cardSyncResult] = await connection.execute(
                    `UPDATE cards 
                     SET status = ?, updated_at = NOW() 
                     WHERE account_number = ?`,
                    [new_status, account_number]
                );
                if (cardSyncResult.affectedRows > 0) {
                    updates.push(`Synchronized ${cardSyncResult.affectedRows} linked card(s) to ${new_status}.`);
                }
            } else {
                // Check if account exists but wasn't updated (e.g., status already set)
                const account = await findAccountByNumber(account_number);
                if (!account) {
                    await connection.rollback();
                    return res.status(404).json({ success: false, error: `Account ${account_number} not found.` });
                }
            }
        }

        // 2. Handle Specific Card Status Update
        if (exid) {
            // Only update the specific card if it wasn't already updated via the account cascade
            const cardUpdateResult = await connection.execute(
                `UPDATE cards 
                 SET status = ?, updated_at = NOW() 
                 WHERE exid = ?`,
                [new_status, exid]
            );

            if (cardUpdateResult[0].affectedRows > 0) {
                cardUpdatePerformed = true;
                updates.push(`Card ${exid} updated to ${new_status}.`);
            } else {
                // Check if card exists but wasn't updated
                const card = await findCardByExid(exid);
                if (!card) {
                    await connection.rollback();
                    return res.status(404).json({ success: false, error: `Card ${exid} not found.` });
                }
            }
        }

        // Ensure at least one update occurred if both identifiers were provided, or the single one was updated.
        if (!accountUpdatePerformed && !cardUpdatePerformed) {
             // Rollback if we failed to update, but only after checking the entities exist (which was done above)
             await connection.rollback();
             return res.status(400).json({ success: false, error: 'No updates were performed. Check if the entity already has the requested status.' });
        }


        await connection.commit();
        
        return res.status(200).json({ 
            success: true, 
            message: 'Status update successful.',
            status_applied: new_status,
            details: updates 
        });

    } catch (e) {
        if (connection) {
            await connection.rollback();
        }
        console.error("STATUS_UPDATE_ERROR:", e.message);
        return res.status(500).json({ success: false, error: `Database or server error: ${e.message}` });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});


// Attach the router to the main app path
app.use('/api/v1/update', updateRouter);

// --- Server Startup ---
(async () => {
    try {
        dbConnection = await mysql.createPool({
            host: "",
            user: "",
            password: "", //  UPDATE THIS PASSWORD
            database: "card_management_system",
            port: 3306,
        });
        console.log("MySQL connected and ready.");

        app.listen(PORT, () => {
            console.log(`Update API running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error("DB Connection Failed:", err.message);
        process.exit(1);
    }
})();