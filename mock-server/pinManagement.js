// ------------------------
// Dependencies
// ------------------------
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

// Load your HSM simulation or SDK (assuming hsmSimulator.js was renamed to hsm.js)
const hsm = require('./hsmSimulator'); // Use hsmSimulator.js name for clarity

// ------------------------
// Create Express App
// ------------------------
const app = express();
app.use(express.json());
app.use(cors());

// ------------------------
// Authentication Middleware
// ------------------------
const authenticate = (req, res, next) => {
    const token = req.headers['authorization'];
    // NOTE: This secret must be stored securely (e.g., environment variable)
    if (!token || token !== 'Bearer sk_test_xxxxxxx') {
        return res.status(401).json({ success: false, error: "Unauthorized request. Missing or invalid token." });
    }
    next();
};

// ------------------------
// DB Connection Setup
// ------------------------
let dbConnection;

(async () => {
    try {
        dbConnection = await mysql.createPool({
            host: "",
            user: "",
            password: "",
            database: "card_management_system",
            port: 3306,
        });
        console.log("MySQL connected.");

        // Start the server ONLY after the DB connection is successful
        const PORT = 3000;
        app.listen(PORT, () => {
            console.log(`PIN Management API running on port ${PORT}`);
        });

    } catch (err) {
        console.error("DB Connection Failed:", err.message);
        process.exit(1); // Exit if DB connection fails
    }
})();

// -------------------------------------------------------
// Helper: PIN Format Check
// -------------------------------------------------------
const isValidPin = (pin) => /^\d{4,12}$/.test(pin);

// -------------------------------------------------------
// Shared Logic for PIN Update
// -------------------------------------------------------
/**
 * Secures the clear PIN using the HSM and updates the PVV in the database.
 * @param {string} external_id - The card's external ID.
 * @param {string} pan - The card's Primary Account Number.
 * @param {string} clear_pin - The clear, unencrypted PIN.
 * @param {object} res - The Express response object.
 */
const updatePin = async (external_id, pan, clear_pin, res) => {
    let newPVV;

    try {
        // HSM: Convert clear PIN -> PVV (PIN Verification Value)
        // This is the core security step. 
        newPVV = await hsm.generatePvv(pan, clear_pin); 
        console.log(`PIN received for EXID ${external_id}. PVV successfully created.`);
    } catch (hsmError) {
        console.error("HSM PIN Creation Error:", hsmError.message);
        return res.status(500).json({
            success: false,
            message: `Secure processing error: Could not encrypt PIN. ${hsmError.message}`
        });
    }

    try {
        // DB: Store the generated PVV and mark the PIN as set
        await dbConnection.execute(
            'UPDATE cards SET pin_set = ?, pvv = ?, updated_at = NOW() WHERE exid = ?',
            ['yes', newPVV, external_id]
        );

        res.status(200).json({
            success: true,
            message: "PIN successfully updated and securely stored.",
            exid: external_id
        });
    } catch (dbError) {
        console.error("PIN Update DB Error:", dbError.message);
        return res.status(500).json({
            success: false,
            message: "Database error during PIN update."
        });
    }
};

// =======================================================
// 			ROUTES (Protected)
// =======================================================

const router = express.Router();

// Apply authentication to all PIN routes
router.use(authenticate);

// ----------------------------
// 1. PIN SET (POST /set)
// For initial PIN creation.
// ----------------------------
router.post('/set', async (req, res) => {
    const { external_id, clear_pin } = req.body;

    // Validation
    if (!external_id || !clear_pin) {
        return res.status(400).json({ success: false, error: "Missing mandatory fields." });
    }
    if (!isValidPin(clear_pin)) {
        return res.status(400).json({ success: false, error: "Invalid PIN format (4-12 digits)." });
    }

    // Lookup card details (PAN and current pin_set status)
    const [cards] = await dbConnection.query(
        'SELECT pan, pin_set FROM cards WHERE exid = ?',
        [external_id]
    );

    if (cards.length === 0) {
        return res.status(404).json({
            success: false,
            error: `Card not found for EXID: ${external_id}.`
        });
    }

    const { pan, pin_set } = cards[0];

    // Check if PIN is already set
    if (pin_set === 'yes') {
        return res.status(400).json({
            success: false,
            error: "PIN already set. Use /change instead."
        });
    }

    // Process PIN update
    await updatePin(external_id, pan, clear_pin, res);
});

// ----------------------------
// 2. PIN CHANGE (POST /change)
// For updating an existing PIN, requires current PIN verification.
// ----------------------------
router.post('/change', async (req, res) => {
    const { external_id, current_pin_block, new_clear_pin } = req.body;

    // Validation
    if (!external_id || !current_pin_block || !new_clear_pin) {
        return res.status(400).json({ success: false, error: "Missing fields." });
    }
    if (!isValidPin(new_clear_pin)) {
        return res.status(400).json({ success: false, error: "Invalid new PIN format." });
    }

    // Lookup card details (PAN, PVV, and pin_set status)
    const [cards] = await dbConnection.query(
        'SELECT pan, pvv, pin_set FROM cards WHERE exid = ?',
        [external_id]
    );

    if (cards.length === 0) {
        return res.status(404).json({ success: false, error: "Card not found." });
    }

    const { pan, pvv, pin_set } = cards[0];

    // Check if PIN was previously set
    if (pin_set === 'no') {
        return res.status(400).json({
            success: false,
            error: "PIN not set. Use /set first."
        });
    }

    // 1. Verify Current PIN
    let isValid;
    try {
        // HSM: Verify the submitted PIN block against the stored PVV
        // 
        isValid = await hsm.verifyPinBlock(pan, current_pin_block, pvv);
    } catch (err) {
        console.error("HSM Verification Error:", err.message);
        return res.status(500).json({
            success: false,
            message: `HSM verification error. ${err.message}`
        });
    }

    if (!isValid) {
        return res.status(401).json({
            success: false,
            error: "Incorrect current PIN."
        });
    }

    // 2. Process New PIN update
    await updatePin(external_id, pan, new_clear_pin, res);
});

// ----------------------------
// 3. PIN VERIFY (POST /verify)
// For verifying a transaction PIN (often used internally by payment gateway).
// ----------------------------
router.post('/verify', async (req, res) => {
    const { external_id, current_pin_block } = req.body;

    if (!external_id || !current_pin_block) {
        return res.status(400).json({
            success: false,
            error: "Missing mandatory fields."
        });
    }

    // Lookup card details (PAN, PVV, and status)
    const [cards] = await dbConnection.query(
        'SELECT pan, pvv, status FROM cards WHERE exid = ?',
        [external_id]
    );

    if (cards.length === 0) {
        return res.status(404).json({ success: false, error: "Card not found." });
    }

    const { pan, pvv, status } = cards[0];

    // Card status check
    if (status !== "Active") {
        return res.status(400).json({
            success: false,
            error: `Card status is ${status}. Verification not allowed.`
        });
    }

    let isValid;
    try {
        // HSM: Verify the submitted PIN block against the stored PVV
        isValid = await hsm.verifyPinBlock(pan, current_pin_block, pvv);
    } catch (e) {
        console.error("Secure processing error:", e.message);
        return res.status(500).json({
            success: false,
            message: `Secure processing error. ${e.message}`
        });
    }

    if (isValid) {
        return res.status(200).json({ success: true, message: "PIN verified." });
    } else {
        return res.status(401).json({ success: false, error: "Incorrect PIN." });
    }
});

// Attach routes to server
app.use("/api/v1/pin", router);