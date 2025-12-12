// hsmSimulator.js

const crypto = require('crypto');
const { MOCK_KEYS, HASH_SALT } = require('./config/hsmKeys');

// --- Helper Functions (Mock Cryptography) ---

/**
 * Mocks the cryptographic operation (e.g., T-DES) using HMAC-SHA256.
 * This ensures the output is deterministic, fixed-length, and appears "encrypted."
 * @param {string} key - The key (e.g., CVK, PVK).
 * @param {string} data - The input data to encrypt/hash.
 * @returns {string} - A 32-character hex string (mock cryptogram).
 */
const mockCryptogram = (key, data) => {
    // Combine sensitive data with the key and a salt for deterministic, secure-looking output
    const hmac = crypto.createHmac('sha256', key + HASH_SALT);
    hmac.update(data);
    // Use the first 32 characters to simulate a fixed-length cryptographic output
    return hmac.digest('hex').toUpperCase().substring(0, 32);
};

// --- CORE HSM FUNCTIONS ---

const hsmSimulator = {

    // ----------------------------------------------------
    // 1. CVV / CVC Generation
    // ----------------------------------------------------

    /**
     * Generates a mock CVV/CVC based on the Visa/Mastercard logic.
     * In a real HSM, this involves T-DES calculation using CVK.
     * @param {string} pan - Primary Account Number.
     * @param {string} expiry - YYMM.
     * @param {string} serviceCode - 3-digit service code.
     * @param {string} keyName - 'CVK' for standard cards.
     * @returns {string} - 3-digit mock CVV/CVC.
     */
    generateCvvCvc: (pan, expiry, serviceCode, keyName = 'CVK') => {
        const key = MOCK_KEYS[keyName];
        if (!key) throw new Error(`Mock Key ${keyName} not found.`);

        // Input data for the mock cipher: PAN + Expiry + ServiceCode
        const data = pan.slice(-16) + expiry + serviceCode;

        const mockResult = mockCryptogram(key, data);

        // Simulate CVV extraction: Take the first 3 numeric digits.
        const digits = mockResult.replace(/\D/g, '');
        if (digits.length < 3) return '000'; // Fallback for very small hash space

        return digits.substring(0, 3);
    },

    /**
     * Generates a mock CVV2/CVC2 (used for card-not-present).
     * @returns {string} - 3-digit mock CVV2/CVC2.
     */
    generateCvvCvc2: (pan, expiry) => {
        // CVV2 logic is usually the same as CVV but uses a specific service code (e.g., '000')
        return hsmSimulator.generateCvvCvc(pan, expiry, '000');
    },

    /**
     * Generates a mock iCVV (used for EMV data, usually derived from a sequence number).
     * @param {string} pan - Primary Account Number.
     * @param {string} sequenceNumber - Card sequence number.
     * @returns {string} - 4-digit mock iCVV.
     */
    generateIcvv: (pan, sequenceNumber) => {
        const key = MOCK_KEYS.CVK;
        const data = pan.slice(-16) + sequenceNumber;
        const mockResult = mockCryptogram(key, data);

        // Simulate 4-digit iCVV
        const digits = mockResult.replace(/\D/g, '');
        if (digits.length < 4) return '0000';
        return digits.substring(0, 4);
    },

    // ----------------------------------------------------
    // 2. PIN Block Validation (ISO-9564 Format 0)
    // ----------------------------------------------------

    /**
     * Generates a mock PVV (PIN Verification Value) for storage.
     * In a real HSM, this is calculated using the PIN, PAN, and PVK.
     * @param {string} pan - Primary Account Number.
     * @param {string} pin - Clear text PIN (4-12 digits).
     * @returns {string} - 4-digit mock PVV.
     */
    generatePvv: (pan, pin) => {
        const key = MOCK_KEYS.PVK;
        // Input data for the mock cipher: PAN + PIN
        const data = pan.slice(-16) + pin;

        const mockResult = mockCryptogram(key, data);

        // Simulate PVV extraction: Take the first 4 numeric digits.
        const digits = mockResult.replace(/\D/g, '');
        if (digits.length < 4) return '1111';

        // PVV is often stored as 4 digits (e.g., used for offline PIN validation).
        return digits.substring(0, 4);
    },

    /**
     * Creates a mock ISO-9564 Format 0 PIN Block.
     * This is typically done by XORing the PIN and PAN.
     * @param {string} pin - Clear text PIN.
     * @param {string} pan - Primary Account Number.
     * @returns {string} - Mock 16-character PIN block (hex).
     */
    createPinBlock0: (pin, pan) => {
        // Length of PIN (e.g., '4' for 4-digit PIN)
        const pinLength = pin.length.toString(16);

        // Pad PIN to 16 characters (e.g., F41234FFFFFFFFFF)
        const paddedPin = (pinLength + pin).padEnd(16, 'F');

        // Use a static slice of the PAN (e.g., last 12 digits, excluding checksum)
        const panSlice = pan.slice(-13, -1);

        // Simulate XOR operation (using simple concatenation for mock output)
        const pinBlockMock = `PB0-${paddedPin.toUpperCase()}-${panSlice}`;

        return Buffer.from(pinBlockMock).toString('hex').substring(0, 16).toUpperCase().padEnd(16, '0');
    },

    /**
     * Verifies a PIN Block against a stored PVV.
     * @param {string} pan - Primary Account Number.
     * @param {string} pinBlock - Encrypted PIN block received from the terminal/app.
     * @param {string} storedPvv - The PVV stored in the CMS database.
     * @returns {boolean} - True if verification succeeds.
     */
    verifyPinBlock: (pan, pinBlock, storedPvv) => {
        // --- Real HSM logic involves ---
        // 1. Decrypting the PIN Block to get the clear PIN.
        // 2. Recalculating the PVV from the clear PIN and PAN.
        // 3. Comparing the recalculated PVV with the storedPvv.

        // --- Mock Logic ---
        // For a mock, we simply check that the PVV starts with a 'verified' pattern.
        // This simulates a successful cryptographic verification.
        const mockDecryptionCheck = pinBlock.startsWith('8') || pinBlock.startsWith('9') || pinBlock.startsWith('A');

        // We ensure the PVV is present and simulate a match check
        const pvvCheck = storedPvv.length === 4 && storedPvv !== '1111';

        return mockDecryptionCheck && pvvCheck;
    },

    // ----------------------------------------------------
    // 3 & 4. EMV Key Derivation and ARQC/ARPC Simulation
    // ----------------------------------------------------

    /**
     * Mocks EMV Session Key Derivation (e.g., MK-AC, MK-SDA).
     * @param {string} masterKeyName - MK_AC or MK_SDA.
     * @param {string} pan - Primary Account Number.
     * @returns {string} - Mock session key (32 hex characters).
     */
    deriveEmvSessionKey: (masterKeyName, pan) => {
        const masterKey = MOCK_KEYS[masterKeyName];
        if (!masterKey) throw new Error(`Master Key ${masterKeyName} not found.`);

        // Real logic derives session keys using DDA/CDA methods.
        const data = pan.slice(-16) + masterKeyName;
        return mockCryptogram(masterKey, data);
    },

    /**
     * Generates a mock ARQC (Application Request Cryptogram).
     * @param {string} pan - Primary Account Number.
     * @returns {string} - Mock 16-character ARQC.
     */
    generateArqc: (pan) => {
        const sessionKey = hsmSimulator.deriveEmvSessionKey('MK_AC', pan);
        // Use session key and some random data to simulate transaction details
        const data = pan.slice(-16) + Date.now().toString();

        // Use the first 16 characters of the result as the ARQC
        return mockCryptogram(sessionKey, data).substring(0, 16);
    },

    /**
     * Validates a mock ARQC (Simulates the issuer checking the cryptogram).
     * @param {string} pan - Primary Account Number.
     * @param {string} arqcReceived - The ARQC provided by the terminal/card.
     * @returns {boolean} - True if valid (for mock, always true if non-empty).
     */
    validateArqc: (pan, arqcReceived) => {
        // In a real system, the HSM would recalculate the ARQC using the same inputs
        // and compare it to the received ARQC.
        if (!arqcReceived || arqcReceived.length !== 16) return false;

        const arqcRecalculated = hsmSimulator.generateArqc(pan);

        // Mock check for security: only check the first 8 characters for simplicity
        return arqcReceived.substring(0, 8) === arqcRecalculated.substring(0, 8);
    },

    /**
     * Generates a mock ARPC (Application Response Cryptogram).
     * @param {string} arqc - The original ARQC received.
     * @param {string} arc - The Authorization Response Code (e.g., '00' for approval).
     * @returns {string} - Mock ARPC (16 hex characters).
     */
    generateArpc: (arqc, arc) => {
        // Simplified mock: ARPC = ARQC XOR ARC
        // We'll use a simple transformation based on the ARC status.
        if (arc === '00') {
            // Mock transformation for approval
            return arqc.substring(0, 14) + 'A' + '5';
        } else {
            // Mock transformation for decline
            return arqc.substring(0, 14) + 'F' + '0';
        }
    }
};

module.exports = hsmSimulator;