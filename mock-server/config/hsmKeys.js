// config/hsmKeys.js
// !!! WARNING: NON-PRODUCTION TEST KEYS !!!
// In a real system, these would be high-entropy, encrypted keys managed by an HSM.

const HASH_SALT = 'CMS-MOCK-SALT'; // Used for generic hashing/mocking cryptographic output

const MOCK_KEYS = {
    // 1. For CVV/CVC Generation
    CVK: '0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D', // Card Verification Key (32 hex chars for T-DES mock)

    // 2. For PIN Validation
    PVK: 'F1E2D3C4B5A69788796A5B4C3D2E1F0A', // PIN Verification Key

    // 3. For EMV Key Derivation (Mock Master Keys)
    MK_AC: 'EMV-AC-MASTER-KEY-TEST-001', // Master Key for Application Cryptogram
    MK_SDA: 'EMV-SDA-MASTER-KEY-TEST-002', // Master Key for Static Data Authentication

    // Optional (for future use)
    MK_DUKPT: 'DUKPT-TEST-KEY-003',
};

module.exports = { MOCK_KEYS, HASH_SALT };