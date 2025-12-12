const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const app = express();
const PORT = 3001;

// --- Configuration ---
const BEARER_TOKEN = 'sk_test_xxxxx'; // MUST BE SET FOR TESTING!
const BASE_CURRENCY = 'ZAR'; // The account base currency is ZAR

// --- Middleware ---
app.use(express.json());
app.use(cors());

/**
 * Bearer Token Authentication Middleware
 */
const authenticateBearer = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "Invalid or missing Bearer token format." });
    }

    const token = authHeader.split(' ')[1]; 
    
    if (token !== BEARER_TOKEN) {
        return res.status(401).json({ success: false, error: "Invalid Bearer token value." });
    }
    
    next();
};

// --- DB Connection Setup ---
let dbConnection;

// --- FEE SCHEDULE ---
const FEE_SCHEDULE = {
    'ATM_WITHDRAWAL': {
        code: 'ATM_WDL_FEE',
        rate: 0.015, min: 5.00, max: 50.00,
        type: 'PERCENTAGE_MIN_MAX'
    },
    'BILL_PAYMENT': {
        code: 'BILL_PAY_FEE',
        rate: 2.50,
        type: 'FIXED'
    },
    'POS_INTERNATIONAL': {
        code: 'EXCHANGE_CTRL_FEE',
        rate: 0.010, min: 10.00,
        type: 'PERCENTAGE_MIN'
    },
    'ECOMMERCE_INTERNATIONAL': {
        code: 'EXCHANGE_CTRL_FEE',
        rate: 0.010, min: 10.00,
        type: 'PERCENTAGE_MIN'
    },
    'VOUCHER_PAYMENT': {
        code: 'VOUCH_PAY_FEE',
        rate: 1.00, // Fixed fee example
        type: 'FIXED'
    },
    'LOTTO_PAYMENT': {
        code: 'LOTTO_PAY_FEE',
        rate: 2.50, // Fixed fee example
        type: 'FIXED'
    }
};

// ------------------------------------------------------------------------
// --- FEE CALCULATION LOGIC ---

/**
 * Calculates transaction fees based on the FEE_SCHEDULE configuration.
 * @param {string} type - The transaction type key.
 * @param {number} amount - The transaction amount in base currency (ZAR).
 * @returns {number} The calculated fee, rounded to two decimal places.
 */
const calculateAndApplyFee = (type, amount) => {
    const feeConfig = FEE_SCHEDULE[type];
    if (!feeConfig) return 0.00;

    let calculatedFee = 0.00;
    switch (feeConfig.type) {
        case 'FIXED':
            calculatedFee = feeConfig.rate;
            break;
        case 'PERCENTAGE_MIN_MAX':
            calculatedFee = amount * feeConfig.rate;
            if (calculatedFee < feeConfig.min) calculatedFee = feeConfig.min;
            if (calculatedFee > feeConfig.max) calculatedFee = feeConfig.max;
            break;
        case 'PERCENTAGE_MIN':
            calculatedFee = amount * feeConfig.rate;
            if (calculatedFee < feeConfig.min) calculatedFee = feeConfig.min;
            break;
    }
    return parseFloat(calculatedFee.toFixed(2));
};

// ------------------------------------------------------------------------
// --- DB Helper Functions ---

/**
 * Gets a hardcoded foreign exchange rate.
 * @param {string} fromCurrency - Source currency code.
 * @param {string} toCurrency - Target currency code.
 * @returns {number|null} The exchange rate, or null if not found.
 */
const getExchangeRate = async (fromCurrency, toCurrency) => {
    if (fromCurrency === toCurrency) return 1.0;
    if (fromCurrency === 'USD' && toCurrency === BASE_CURRENCY) return 18.50;
    if (fromCurrency === 'EUR' && toCurrency === BASE_CURRENCY) return 20.00;
    return null;
};

/**
 * Checks if a card is expired (placeholder).
 * @param {string} expiryDate - Card expiry date (MM/YY).
 * @returns {boolean}
 */
const isCardExpired = (expiryDate) => {
    // This function should contain actual date logic
    return false; 
};

/**
 * Fetches required authorization data from the database.
 * @param {string} externalId - The card's external identifier (EXID).
 * @returns {object|null} Account and card details, or null if not found.
 */
const getAuthData = async (externalId) => {
    if (!externalId) return null;

    if (!dbConnection) {
        console.error("DB_ACCESS_ERROR: Database connection is not established.");
        throw new Error('Database system offline.'); 
    }

    try {
        const query = `
            SELECT 
                a.account_number, 
                a.balance, a.status AS account_status, a.daily_spent, a.daily_limit, a.international_enabled, 
                c.status AS card_status, c.expiry, c.limit_amount, c.product_code
            FROM accounts a
            JOIN cards c ON a.account_number = c.account_number
            WHERE c.exid = ?`; 
                
        const [rows] = await dbConnection.query(query, [externalId]);
        
        if (rows.length === 0) return null;

        const authData = rows[0];

        // CRITICAL FIX: Ensure all monetary/limit values are JS numbers
        authData.balance = parseFloat(authData.balance);
        authData.daily_spent = parseFloat(authData.daily_spent);
        authData.daily_limit = parseFloat(authData.daily_limit);
        authData.limit_amount = parseFloat(authData.limit_amount);
        
        return authData;

    } catch (error) {
        console.error(`DB_QUERY_ERROR: Failed to run authorization query. Error: ${error.message}`);
        throw new Error('Database lookup failed during authorization.'); 
    }
};

/**
 * Retrieves the fee_id from fees_schedule using the fee_code.
 * @param {string} feeCode - The internal fee code.
 * @returns {number|null} The fee_id or null.
 */
const getFeeIdByCode = async (feeCode) => {
    if (!feeCode || !dbConnection) return null;
    try {
        // Use dbConnection.query() which uses the pool directly.
        const [rows] = await dbConnection.query('SELECT fee_id FROM fees_schedule WHERE fee_code = ?', [feeCode]);
        return rows.length > 0 ? rows[0].fee_id : null;
    } catch (e) {
        console.error("DB_ERROR: Failed to lookup fee_id:", e.message);
        return null;
    }
};

/**
 * Performs a fund deposit using a database transaction.
 * Also synchronizes the cards.balance column.
 * @param {string} accountNumber - The target account number.
 * @param {number} amount - The deposit amount.
 * @param {string} currency - The deposit currency.
 * @returns {object} Transaction result object.
 */
const performDeposit = async (accountNumber, amount, currency) => {
    if (currency !== BASE_CURRENCY) {
        throw new Error('Deposit currency must match base currency (ZAR) for this implementation.');
    }

    if (!accountNumber) {
        return { success: false, reason: 'Invalid account number provided.' };
    }

    let connection;
    try {
        connection = await dbConnection.getConnection();
        await connection.beginTransaction();

        // 1. Update the accounts balance
        const [updateAccountResult] = await connection.execute(
            `UPDATE accounts
             SET balance = balance + ?, updated_at = NOW()
             WHERE account_number = ? AND status = 'Active'`, 
            [amount, accountNumber]
        );

        if (updateAccountResult.affectedRows === 0) {
            const [check] = await connection.query('SELECT status FROM accounts WHERE account_number = ?', [accountNumber]);
            await connection.rollback();
            if (check.length === 0) {
                return { success: false, reason: 'Account not found.' };
            } else if (check[0].status !== 'Active') {
                return { success: false, reason: `Account is ${check[0].status} and cannot receive funds.` };
            }
            return { success: false, reason: 'Deposit failed, balance unchanged.' };
        }
        
        // 2. Fetch the new balance
        const [newBalanceRow] = await connection.query('SELECT balance FROM accounts WHERE account_number = ?', [accountNumber]); 
        const newBalance = parseFloat(newBalanceRow[0].balance);

        // 3. SYNCHRONIZATION: Update the cards balance
        await connection.execute(
            `UPDATE cards
             SET balance = ?, updated_at = NOW()
             WHERE account_number = ?`,
            [newBalance, accountNumber]
        );
        
        await connection.commit();

        return { 
            success: true, 
            reason: 'Deposit successful.', 
            new_balance: newBalance.toFixed(2) 
        };
    } catch (e) {
        if (connection) {
            await connection.rollback();
        }
        console.error(`Deposit database error for ${accountNumber}:`, e.message);
        throw new Error('Database error during deposit transaction.');
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// ========================================================================
// --- 1. AUTHORIZATION ROUTER (DEBIT/LIMITS) ---
// ========================================================================

const authRouter = express.Router();
authRouter.use(authenticateBearer);

/**
 * Handles all debit authorization requests (e.g., POS, ATM, E-commerce).
 * Uses a database transaction to ensure atomicity of balance and spend updates.
 * 
 */
authRouter.post('/authorize', async (req, res) => {
    const {
        transaction_type,
        external_id, 
        amount,
        currency_code
    } = req.body;

    const amountValue = parseFloat(amount);
    
    // Validate mandatory request fields
    if (!transaction_type || !external_id || isNaN(amountValue) || amountValue <= 0 || !currency_code) {
        return res.status(400).json({ success: false, response: "Declined", reason: "Invalid Request Data (Missing external_id, Type, Amount, or Currency)" });
    }

    let connection;
    try {
        connection = await dbConnection.getConnection();
        await connection.beginTransaction();

        const authData = await getAuthData(external_id);

        if (!authData) {
            await connection.rollback();
            return res.status(404).json({ success: false, response: "Declined", reason: "Card/Account Not Found" });
        }

        // Handle Balance Inquiry as a read-only transaction
        if (transaction_type === "ATM_Balance_Inquiry") {
            // No commit or rollback needed for read-only operation
            connection.release(); // Release connection immediately
            return res.status(200).json({ success: true, balance: authData.balance });
        }
        
        // --- 1. Currency Conversion ---
        let amountInBaseCurrency = amountValue;
        if (currency_code !== BASE_CURRENCY) {
            const fxRate = await getExchangeRate(currency_code, BASE_CURRENCY);
            if (!fxRate) {
                await connection.rollback();
                return res.status(500).json({ success: false, response: "Declined", reason: "FX_RATE_UNAVAILABLE" });
            }
            amountInBaseCurrency = amountValue * fxRate;
        }

        // --- 2. Fee Calculation ---
        const totalFee = calculateAndApplyFee(transaction_type, amountInBaseCurrency);
        const totalDebitAmount = amountInBaseCurrency + totalFee;
        const feeCode = FEE_SCHEDULE[transaction_type]?.code;

        // --- 3. Status and Limit Checks ---
        if (authData.account_status !== 'Active' || authData.card_status !== 'Active') {
            await connection.rollback();
            return res.status(403).json({ success: false, response: "Declined", reason: `Reason=${authData.account_status !== 'Active' ? authData.account_status : authData.card_status}` });
        }
        if (isCardExpired(authData.expiry)) {
            await connection.rollback();
            return res.status(403).json({ success: false, response: "Declined", reason: "Reason=Expired" });
        }
        
        // Insufficient Funds Check (must cover transaction amount + fee)
        if (authData.balance < totalDebitAmount) {
            await connection.rollback();
            return res.status(403).json({ success: false, response: "Declined", reason: "Reason=InsufficientFunds" });
        }
        
        // Daily Limit Check
        const effectiveLimit = authData.daily_limit || authData.limit_amount;
        if (effectiveLimit && (authData.daily_spent + amountInBaseCurrency > effectiveLimit)) {
            await connection.rollback();
            return res.status(403).json({ success: false, response: "Declined", reason: "Reason=ExceedsLimit" });
        }
        
        // ---------------------------------------------------
        // --- 4. Database Update (CRITICAL COMMIT STEP) ---
        // ---------------------------------------------------
        
        const newBalance = authData.balance - totalDebitAmount;
        
        // a) Update Account Balance and Daily Spend (Primary update)
        await connection.execute(
            `UPDATE accounts 
             SET balance = ?, daily_spent = daily_spent + ?, updated_at = NOW() 
             WHERE account_number = ?`,
            [newBalance, amountInBaseCurrency, authData.account_number]
        );
        
        // b) SYNCHRONIZATION: Update Card Balance (Secondary update)
        await connection.execute(
            `UPDATE cards
             SET balance = ?, updated_at = NOW()
             WHERE account_number = ?`,
            [newBalance, authData.account_number]
        );

        // c) Log Fee (If applicable)
        if (totalFee > 0 && feeCode) {
            const feeId = await getFeeIdByCode(feeCode); 
            
            if (!feeId) {
                // Should not happen if fee schedule is maintained, but roll back if necessary
                await connection.rollback();
                console.error(`FEE_LOOKUP_FAILED: No fee_id found for code: ${feeCode}`);
                return res.status(500).json({ success: false, response: "Declined", reason: "FEE_SCHEDULE_MISSING_DB_ENTRY" });
            }

             await connection.execute(
                 `INSERT INTO fee_ledger 
                   (fee_id, account_number, fee_code, charged_amount, status) 
                   VALUES (?, ?, ?, ?, ?)`,
                 [
                     feeId, 
                     authData.account_number, 
                     feeCode, 
                     totalFee,
                     'POSTED' 
                 ]
             );
        }

        await connection.commit();
        
        // --- 5. Final Response ---
        return res.status(200).json({
            success: true,
            response: "Approved",
            transaction_type: transaction_type,
            amount_debited_base_currency: amountInBaseCurrency.toFixed(2),
            fee_amount: totalFee.toFixed(2),
            total_debit: totalDebitAmount.toFixed(2),
            balance_after_txn: newBalance.toFixed(2)
        });

    } catch (e) {
        if (connection) {
            await connection.rollback();
        }
        console.error("AUTHORIZATION_SYSTEM_ERROR:", e.message);
        return res.status(500).json({ success: false, response: "Declined", reason: `Internal System Error: ${e.message}` });
    } finally {
        if (connection) {
            connection.release();
        }
    }
}); 

// ========================================================================
// --- 2. FUNDS MANAGEMENT ROUTER (DEPOSIT/CREDIT) ---
// ========================================================================

const fundsRouter = express.Router();
fundsRouter.use(authenticateBearer); // Applying Bearer Auth to Funds endpoints

/**
 * Endpoint to handle fund deposits/top-ups.
 * POST /api/v1/funds/depositFunds
 */
fundsRouter.post('/depositFunds', async (req, res) => {
    const { account_number, amount, currency_code } = req.body;

    const amountValue = parseFloat(amount);
    if (!account_number || isNaN(amountValue) || amountValue <= 0 || !currency_code) {
        return res.status(400).json({ success: false, error: 'Missing mandatory fields.' });
    }

    try {
        const result = await performDeposit(account_number, amountValue, currency_code);

        if (result.success) {
            return res.status(200).json({
                success: true,
                message: result.reason,
                account_number,
                new_balance: result.new_balance
            });
        } else {
            return res.status(403).json({ success: false, error: result.reason });
        }
    } catch (e) {
        console.error('Deposit processing error:', e.message);
        return res.status(500).json({ success: false, error: `Internal System Error: ${e.message}` });
    }
});
// ------------------------------------------------------------------------
// --- FINAL API ROUTER ATTACHMENT ---
// Both routers must be attached here to enable their paths.
app.use('/api/v1/auth', authRouter); 
app.use('/api/v1/funds', fundsRouter);
// --- Server Startup ---
(async () => {
    try {
        // DB Connection Pool Initialization
        dbConnection = await mysql.createPool({
            host: '',
            user: '',
            password: '',
            database: 'card_management_system',
            port: '',
        });
        console.log("MySQL connected and ready.");

        app.listen(PORT, () => {
            console.log(`Authorization API running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error("DB Connection Failed:", err.message);
        process.exit(1);
    }
})();