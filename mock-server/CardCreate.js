const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
const port = 3000;

app.use(express.json());

// --- Database Configuration ---
const dbConfig = {
    host: '',
    user: '',
    password: '',
    database: 'card_management_system',
    port: '',
};

let dbConnection;

// --- Database Connection Pool Setup ---
async function connectDB() {
    try {
        dbConnection = await mysql.createPool(dbConfig);
        console.log("Successfully connected to MySQL Database!");
    } catch (error) {
        console.error("Failed to connect to MySQL Database:", error.message);
        process.exit(1);
    }
}
connectDB();

// --- Utility Functions ---
const generateUniqueId = (prefix) => `${prefix}-${Date.now() % 100000}`;
const generateAccountNumber = () => (Math.floor(Math.random() * 90000000000) + 10000000000).toString();
const generateCVV = () => (Math.floor(Math.random() * 900) + 100).toString();
const generateExpiry = (years = 4) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${year}`;
};
const generatePan = (isNewPan = true) => {
    const CARD_BIN = '552255';
    if (isNewPan) {
        const middle = (Math.floor(Math.random() * 900000) + 100000).toString();
        const lastFour = (Math.floor(Math.random() * 9000) + 1000).toString();
        const fullPan = `${CARD_BIN}${middle}${lastFour}`;
        const maskedPan = `${CARD_BIN}******${lastFour}`;
        return { fullPan, maskedPan };
    }
    // Placeholder for existing PAN lookup/reuse
    return { fullPan: "5522551234567890", maskedPan: "552255******7890" };
};
const VALID_PRODUCT_CODES = ['CHQ-01', 'SAV-02'];

// Function to generate a unique 16-digit numeric EXID
const generateEXID = () => {
    // Generate a number between 10^15 and 10^16 - 1, resulting in a 16-digit string
    let id = '';
    while (id.length < 16) {
        id += Math.floor(Math.random() * 10).toString();
    }
    return id;
};


// ====================================================================
// --- 1. CREATE ENDPOINTS (INSERT) ---
// ====================================================================

/** 1. Client Create */
app.post('/api/v1/client/create', async (req, res) => {
    const data = req.body;

    // Validation Check: Missing mandatory fields
    if (!data.name || !data.id_number || !data.date_of_birth || !data.gender) {
        return res.status(400).json({
            success: false,
            error: "Missing mandatory client fields: name, id_number, date_of_birth, gender."
        });
    }

    // Check for duplicate client
    try {
        const checkSql = `
            SELECT client_id 
            FROM clients 
            WHERE name = ? 
              AND surname = ? 
              AND id_number = ? 
              AND date_of_birth = ? 
              AND gender = ?
        `;
        
        const checkValues = [
            data.name,
            data.surname,
            data.id_number,
            data.date_of_birth,
            data.gender
        ];

        // Assuming dbConnection.execute returns [rows, fields]
        const [existingClients] = await dbConnection.execute(checkSql, checkValues);

        if (existingClients.length > 0) {
            // Return 409 Conflict if client exists
            return res.status(409).json({
                success: false,
                message: "Client already exists with the provided name, surname, ID Number, DOB, and Gender.",
                client_id: existingClients[0].client_id // ID of the existing client
            });
        }
    } catch (checkError) {
        console.error("Client DB CHECK Error:", checkError.message);
        // Fail-safe: Return 500 if the check query itself fails
        return res.status(500).json({
            success: false,
            message: "Database error during client existence check.",
            details: checkError.message
        });
    }

    const clientId = generateUniqueId("CL");

    // SQL Statement: Lists all columns being inserted
    const sql = `
        INSERT INTO clients (
            client_id, name, surname, id_number, date_of_birth, gender, 
            country, city, province, street, postal_code, 
            income, tax_number
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Values Array: Mapped, with null applied to all optional fields
    const values = [
        clientId,
        data.name,
        data.surname,
        data.id_number,
        data.date_of_birth,
        data.gender,

        // Address Fields
        data.address?.country ?? null,
        data.address?.city ?? null,
        data.address?.province ?? null,
        data.address?.street ?? null,
        data.address?.postal_code ?? null,

        // Optional Fields
        data.income ?? null,
        data.tax_number ?? null
    ];

    try {
        await dbConnection.execute(sql, values);
        return res.status(201).json({
            success: true,
            message: "Client created",
            client_id: clientId,
        });
    } catch (dbError) {
        console.error("Client DB INSERT Error:", dbError.message);
        // Generic database error on insert
        return res.status(500).json({
            success: false,
            message: "Database error during client creation.",
            details: dbError.message
        });
    }
});


/** 2. Account Create */
// Helper function to get today's date in YYYY-MM-DD format
const getTodayDate = () => {
    return new Date().toISOString().split('T')[0];
};

app.post('/api/v1/account/create', async (req, res) => {
    // Destructure 'dateOpened' and rename it to 'date_opened' for consistency
    const { client_id, product_code, dateOpened: date_opened } = req.body;
    
    // Mandatory Field Check for product_code
    if (!product_code) {
        return res.status(400).json({
            success: false,
            error: "Missing or invalid mandatory field: product_code."
        });
    }

    // Validation: Product Code (Local array lookup)
    if (!VALID_PRODUCT_CODES.includes(product_code)) {
        return res.status(400).json({ 
            success: false, 
            error: `Invalid product code: ${product_code}. Product not found in valid list.` 
        });
    }

    // Validation: Date Opened must be the current date
    const today = getTodayDate();
    const submittedDate = date_opened || today; 

    if (submittedDate !== today) {
        return res.status(400).json({
            success: false,
            error: `Date Opened must be the current calendar date (${today}).`
        });
    }

    // Validation: Check for mandatory client_id
    if (!client_id) {
        return res.status(400).json({ success: false, error: "Missing mandatory field: client_id." });
    }

    // Validation: Check if Client exists
    const [clients] = await dbConnection.query('SELECT client_id FROM clients WHERE client_id = ?', [client_id]);
    if (clients.length === 0) {
        return res.status(404).json({ success: false, error: `Client ID ${client_id} not found.` });
    }

    // Action: Generate ID and INSERT
    const accountNumber = generateAccountNumber();
    const sql = `
        INSERT INTO accounts (account_number, client_id, product_code, date_opened, status) 
        VALUES (?, ?, ?, ?, 'Active')
    `;

    const insertionDate = today; 

    try {
        await dbConnection.execute(sql, [accountNumber, client_id, product_code, insertionDate]);
        return res.status(201).json({
            success: true,
            message: "Account created",
            account_number: accountNumber,
            status: 'Active',
        });
    } catch (dbError) {
        console.error("Account DB INSERT Error:", dbError.message);
        return res.status(500).json({ success: false, message: "Internal server error occurred during account creation." });
    }
});


/** 3. Card Create - Auto-generates EXID */
app.post('/api/v1/card/create', async (req, res) => {
    // Destructuring request body
    const { account_number, product_code, emboss_name, limit_amount } = req.body;

    // 1. Mandatory Field Check: emboss_name
    if (!emboss_name || typeof emboss_name !== 'string' || emboss_name.trim() === '') {
        return res.status(400).json({ success: false, error: "Validation Error: 'emboss_name' is a mandatory field and cannot be empty." });
    }

    // 2. Product Code Validation (Array Lookup)
    if (!VALID_PRODUCT_CODES.includes(product_code)) {
        return res.status(404).json({ 
            success: false, 
            error: `Validation Error: Product Code ${product_code} not found or is invalid. Valid codes are: ${VALID_PRODUCT_CODES.join(', ')}.` 
        });
    }

    // 3. Existing Account Check
    try {
        const [accounts] = await dbConnection.query('SELECT account_number FROM accounts WHERE account_number = ?', [account_number]);
        if (accounts.length === 0) {
            return res.status(404).json({ success: false, error: `Account Number ${account_number} not found.` });
        }
    } catch (dbError) {
        // Handle system error during Account lookup
        console.error("Account DB Lookup Error:", dbError.message);
        return res.status(500).json({
            success: false,
            message: "Internal System Error during account validation. Please contact support.",
        });
    }

    // Action: Generate Details and INSERT
    const { fullPan, maskedPan } = generatePan(true);
    const cardId = generateUniqueId("CARD");
    const cvv = generateCVV();
    const expiry = generateExpiry(4);
    const external_id = generateEXID(); 

    const sql = `
        INSERT INTO cards (card_id, account_number, product_code, pan, masked_pan, exid, cvv, expiry, emboss_name, status, limit_amount, pin_set) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        cardId,
        account_number,
        product_code,
        fullPan,
        maskedPan,
        external_id,
        cvv,
        expiry,
        emboss_name,
        'Inactive',
        parseFloat(limit_amount) ?? 0.00,
        'no'
    ];

    try {
        await dbConnection.execute(sql, values);
        return res.status(201).json({
            success: true,
            message: "Card created, EXID generated",
            card_id: cardId,
            pan: maskedPan,
            external_id: external_id,
            status: 'Inactive',
        });
    } catch (dbError) {
        console.error("Card DB INSERT Error:", dbError.message);
        return res.status(500).json({
            success: false,
            message: "Internal System Error during card creation.",
        });
    }
});


// ====================================================================
// --- 2. UPDATE ENDPOINTS (SELECT + UPDATE/INSERT) ---
// ====================================================================

/** 4. Card Reissue / Replacement / Renewal */
app.post('/api/v1/card/reissue', async (req, res) => {
    // Destructure: 'external_id' for lookup and 'reason_code' for action type
    const { external_id, reason_code } = req.body;

    // Initial validation
    if (!external_id || !reason_code) {
        return res.status(400).json({ success: false, error: "Missing mandatory fields: external_id or reason_code." });
    }

    // 1. Select: Retrieve the existing card record using the secure EXID
    const [oldCards] = await dbConnection.query('SELECT * FROM cards WHERE exid = ?', [external_id]);
    if (oldCards.length === 0) {
        return res.status(404).json({ success: false, error: `Original card not found for EXID: ${external_id}.` });
    }
    const oldCard = oldCards[0];

    // Prepare variables for the new card record
    let newCardDetails = { ...oldCard };
    let newCardId = generateUniqueId("RPLC");
    let message = "";
    let oldCardStatus = '';

    // Logic for Renewal, Replacement, and Reissue
    switch (reason_code) {
        case 'RENEW':
            // RENEWAL: Same PAN, New CVV, New Expiry, NEW EXID
            oldCardStatus = 'EXPIRED';

            newCardDetails.cvv = generateCVV();
            newCardDetails.expiry = generateExpiry(4);
            newCardDetails.pan = oldCard.pan;
            newCardDetails.masked_pan = oldCard.masked_pan;
            newCardDetails.exid = generateEXID();

            message = "Card successfully renewed. Same PAN, new CVV/Expiry/EXID generated.";
            break;

        case 'LOST':
        case 'STOLEN':
            // REPLACEMENT: New PAN, New CVV, New Expiry, New EXID, Block old card
            oldCardStatus = 'BLOCKED';

            // Generate ALL new identifiers
            const { fullPan: newPan, maskedPan: newMaskedPan } = generatePan(true);
            const newExid = generateEXID();

            // Assign new identifiers to the new card record
            newCardDetails.pan = newPan;
            newCardDetails.masked_pan = newMaskedPan;
            newCardDetails.cvv = generateCVV();
            newCardDetails.expiry = generateExpiry(4);
            newCardDetails.exid = newExid;

            message = `Card replaced due to ${reason_code}. New PAN/CVV/EXID issued.`;
            break;

        case 'DAMAGED':
        case 'CHIP_ERROR':
        case 'REPRINT':
            // REISSUE: Same PAN, Same CVV, Same Expiry, NEW EXID
            oldCardStatus = 'REPLACED';

            // Keep all existing details
            newCardDetails.cvv = oldCard.cvv;
            newCardDetails.expiry = oldCard.expiry;
            newCardDetails.pan = oldCard.pan;
            newCardDetails.masked_pan = oldCard.masked_pan;
            newCardDetails.exid = generateEXID();

            message = `Card reissued/reprinted due to ${reason_code}. Same card details, new EXID used.`;
            break;

        default:
            return res.status(400).json({ success: false, error: "Invalid reason code. Must be RENEW, LOST, STOLEN, DAMAGED, CHIP_ERROR, or REPRINT." });
    }

    // 2. Action 1: Update the status of the OLD card record
    try {
        await dbConnection.execute('UPDATE cards SET status = ?, updated_at = NOW() WHERE exid = ?', [oldCardStatus, external_id]);
    } catch (dbError) {
        console.error(`Reissue DB UPDATE Old Card Status Error (Status: ${oldCardStatus}, EXID: ${external_id}):`, dbError.message);
        return res.status(500).json({ success: false, message: `Database error during old card status update: ${dbError.message}` });
    }

    // 3. Action 2: Insert the new card record
    newCardDetails.card_id = newCardId;
    newCardDetails.status = 'INACTIVE';

    // Parse the limit amount
    const parsedLimit = parseFloat(newCardDetails.limit_amount);

    // SQL Statement for inserting the new card
    const insertSql = `
        INSERT INTO cards (card_id, account_number, product_code, pan, masked_pan, exid, cvv, expiry, emboss_name, status, limit_amount, pin_set)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const insertValues = [
        newCardId,
        newCardDetails.account_number,
        newCardDetails.product_code,
        newCardDetails.pan,
        newCardDetails.masked_pan,
        newCardDetails.exid,
        newCardDetails.cvv,
        newCardDetails.expiry,
        newCardDetails.emboss_name,
        newCardDetails.status,
        // Ensure limit_amount is a valid number
        isNaN(parsedLimit) ? 0.00 : parsedLimit,
        newCardDetails.pin_set
    ];

    try {
        await dbConnection.execute(insertSql, insertValues);

        // 4. Success Response
        res.status(200).json({
            success: true,
            message: message,
            old_card_id: oldCard.card_id,
            old_card_status: oldCardStatus,
            new_card_id: newCardId,
            new_pan: newCardDetails.masked_pan,
            new_expiry: newCardDetails.expiry,
            new_exid: newCardDetails.exid
        });
    } catch (dbError) {
        console.error("Reissue DB INSERT Error (Full Message):", dbError);
        return res.status(500).json({ success: false, message: `Database error during new card insertion: ${dbError.message}` });
    }
});

/** 5. Card Activation */
app.post('/api/v1/card/activate', async (req, res) => {

    // Using exId for lookup
    const { exId, cvv, expiry } = req.body;

    // Initial validation
    if (!exId || !cvv || !expiry) {
        return res.status(400).json({ success: false, error: "Missing mandatory fields: exId, cvv, or expiry." });
    }

    // 1. Select: Retrieve the existing card record using the EXID
    const [cards] = await dbConnection.query('SELECT * FROM cards WHERE exid = ?', [exId]);
    if (cards.length === 0) {
        return res.status(404).json({ success: false, error: `Card not found for EXID: ${exId}.` });
    }
    const card = cards[0];

    // 2. Logic Checks
    // Validation Check: CVV and Expiry must match
    if (card.cvv !== cvv || card.expiry !== expiry) {
        return res.status(403).json({ success: false, error: "Validation failed: CVV or Expiry mismatch." });
    }

    // Status Check: Only 'Inactive' cards can be activated
    if (card.status !== 'Inactive') {
        return res.status(400).json({ success: false, error: `Card status is ${card.status}. Only Inactive cards can be activated.` });
    }

    // Action: Update status in DB
    const newStatus = 'Active';

    try {
        await dbConnection.execute(
            // Update the status using the exId
            'UPDATE cards SET status = ?, updated_at = NOW() WHERE exid = ?',
            [newStatus, exId]
        );

        // 3. Success Response
        res.status(200).json({
            success: true,
            message: `Card associated with EXID ${exId} activated successfully.`,
            card_id: card.card_id,
            masked_pan: card.masked_pan,
            card_status: newStatus
        });

    } catch (dbError) {
        console.error("Activation DB UPDATE Error:", dbError.message);
        return res.status(500).json({ success: false, message: `Database error during activation: ${dbError.message}` });
    }
});

/** 6. Card Status Change */
app.put('/api/v1/card/status', async (req, res) => {

    // 1. Destructure: Expect 'external_id' (EXID) and 'block_code'
    const { external_id, block_code } = req.body;

    // Initial validation
    if (!external_id || !block_code) {
        return res.status(400).json({ success: false, error: "Missing mandatory fields: external_id or block_code." });
    }

    // Convert block_code to uppercase for consistent processing
    const PROCESSED_BLOCK_CODE = (block_code === '_') ? '_' : block_code.toUpperCase();

    // 2. Select: Check if card exists and retrieve details for the response
    const [cards] = await dbConnection.query('SELECT card_id, masked_pan, status, block_code FROM cards WHERE exid = ?', [external_id]);
    if (cards.length === 0) {
        return res.status(404).json({ success: false, error: `Card not found for EXID: ${external_id}.` });
    }
    const card = cards[0];
    const { card_id, masked_pan, block_code: currentBlockCode } = card;

    // 3. Logic: Determine new status based on the simplified macro block_code
    let newStatus;
    let customMessage = null; // Variable to hold the specific removal message

    /* * Mapping Macro Block Codes (T, B, C, L, S, F, D, M) 
     * to MySQL ENUM Statuses ('Active','Inactive','Blocked','Expired')
     */
    switch (PROCESSED_BLOCK_CODE) {
        case 'T': // Temporary Block
        case 'M': // Chip Malfunction
            newStatus = 'Blocked'; 
            break;

        case 'B': // Permanent Block - General Permanent block
        case 'L': // Lost Card - Permanent Block
        case 'S': // Stolen Card - Permanent Block
        case 'F': // Fraud Block
        case 'D': // Damaged Card
            newStatus = 'Blocked';
            break;

        case 'C': // Closed/Cancelled by Customer
            newStatus = 'Inactive';
            break;

        case 'ACTIVE': // Explicit code to unblock/activate the card
            newStatus = 'Active'; 
            break;
            
        case '_': // Special code for temporary block removal
            if (currentBlockCode === 'T' || currentBlockCode === 'M') {
                // ONLY allow removal if the current block is 'T' or 'M' (reversible temporary blocks)
                newStatus = 'Active';
                
                // Set custom message for specific removal
                if (currentBlockCode === 'T') {
                    customMessage = "Temporary Block (T) successfully removed.";
                } else if (currentBlockCode === 'M') {
                    customMessage = "Malfunction Block (M) successfully removed.";
                }
            } else {
                // Reject removal if the current block is permanent or inactive
                return res.status(403).json({
                    success: false,
                    error: `Removal code '_' is only applicable for Temporary Blocks (T) or Malfunction Blocks (M). Current block: ${currentBlockCode}.`
                });
            }
            break;

        default:
            // If the code is not one of the recognized macro codes, return an error
            return res.status(400).json({
                success: false,
                error: `Invalid block code or block code not recognized: ${block_code}. Recognized codes: T, B, C, L, S, F, D, M, ACTIVE, _ (for T/M removal).`
            });
    }
    
    // 4. Action: Update status and block_code in DB
    try {
        // Determine the block_code to store in the DB
        let dbBlockCode;
        if (newStatus === 'Active') {
            // If the card is moving to Active, clear the block_code
            dbBlockCode = '';
        } else {
            // Otherwise, store the new block code
            dbBlockCode = PROCESSED_BLOCK_CODE;
        }

        await dbConnection.execute(
            'UPDATE cards SET status = ?, block_code = ?, updated_at = NOW() WHERE exid = ?',
            [newStatus, dbBlockCode, external_id]
        );

        // 5. Success Response
        const finalMessage = customMessage || `Card status successfully updated to ${newStatus} with code ${dbBlockCode}.`;

        res.status(200).json({
            success: true,
            message: finalMessage,
            external_id: external_id,
            card_id: card_id,
            masked_pan: masked_pan,
            new_status: newStatus,
            block_code: dbBlockCode
        });

    } catch (dbError) {
        console.error("Status Change DB UPDATE Error:", dbError.message);
        return res.status(500).json({ success: false, message: `Database error during status change: ${dbError.message}` });
    }
});

// ====================================================================
// --- 3. GET ENDPOINTS (SELECT) ---
// ====================================================================

/** 7. Get card details */
// Route uses the external identifier (exid)
app.get('/api/v1/card/:exid', async (req, res) => {

    const { exid } = req.params;

    // 1. Select: Retrieve non-sensitive card details
    const sql = 'SELECT card_id, exid, account_number, masked_pan, expiry, status, limit_amount, pin_set, block_code, updated_at FROM cards WHERE exid = ?';

    try {
        const [rows] = await dbConnection.query(sql, [exid]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: `Card not found for EXID: ${exid}.` });
        }

        const cardDetails = rows[0];

        // 2. Conditional Response Logic
        // If the status is not 'Blocked', remove the block_code field
        if (cardDetails.status !== 'Blocked') {
            delete cardDetails.block_code;
        }

        // 3. Success Response
        res.status(200).json(cardDetails);

    } catch (dbError) {
        console.error("Card GET Error:", dbError.message);
        res.status(500).json({ success: false, message: "Database error during retrieval." });
    }
});

/** 8. Get client details */
app.get('/api/v1/client/:client_id', async (req, res) => {
    // Select all client details
    const sql = 'SELECT * FROM clients WHERE client_id = ?';
    try {
        const [rows] = await dbConnection.query(sql, [req.params.client_id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: "Client not found." });
        }
        res.status(200).json(rows[0]);
    } catch (dbError) {
        console.error("Client GET Error:", dbError.message);
        res.status(500).json({ success: false, message: "Database error during retrieval." });
    }
});

/** 9. Get account details */
app.get('/api/v1/account/:account_number', async (req, res) => {
    // Select all account details
    const sql = 'SELECT * FROM accounts WHERE account_number = ?';
    try {
        const [rows] = await dbConnection.query(sql, [req.params.account_number]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: "Account not found." });
        }
        res.status(200).json(rows[0]);
    } catch (dbError) {
        console.error("Account GET Error:", dbError.message);
        res.status(500).json({ success: false, message: "Database error during retrieval." });
    }
});

/** 10. Card Status Check (Lightweight) */
app.get('/api/v1/card/check-status/:exid', async (req, res) => {

    const { exid } = req.params;

    // 1. Select: Retrieve ONLY the status and block_code for a quick check.
    const sql = 'SELECT status, block_code FROM cards WHERE exid = ?';

    try {
        const [rows] = await dbConnection.query(sql, [exid]);

        if (rows.length === 0) {
            // Card not found for the given EXID
            return res.status(404).json({ success: false, error: `Card not found for EXID: ${exid}.` });
        }

        const cardStatusInfo = rows[0];

        // 2. Conditional Response Logic
        // If the card is not explicitly 'Blocked', remove the block_code field from the response.
        if (cardStatusInfo.status !== 'Blocked') {
            delete cardStatusInfo.block_code;
        }

        // 3. Success Response
        res.status(200).json({
            success: true,
            exid: exid,
            ...cardStatusInfo,
        });

    } catch (dbError) {
        console.error("Card Status Check GET Error:", dbError.message);
        // Generic 500 error on database failure
        res.status(500).json({ success: false, message: "Database error during status retrieval." });
    }
});


// --- START SERVER ---
app.listen(port, () => {
    console.log(`\nMock CMS API running and listening at http://localhost:${port}`);
    console.log('Server is integrated with MySQL. Data persistence is active.');
});