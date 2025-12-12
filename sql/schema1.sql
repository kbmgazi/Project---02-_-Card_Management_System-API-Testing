-- SQL SCRIPT: CARD_MANAGEMENT_SYSTEM SCHEMA CREATION
--
-- This script creates the 'card_management_system' database (if it doesn't exist)
-- and defines all six tables (clients, accounts, cards, fees_schedule, fee_ledger)
-- with their respective columns, constraints, and relationships.
--

-- 1. DATABASE SETUP
CREATE DATABASE IF NOT EXISTS `card_management_system` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `card_management_system`;


-- 2. CLIENTS TABLE
-- Table structure for table `clients`
DROP TABLE IF EXISTS `clients`;
CREATE TABLE `clients` (
    `client_id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `surname` VARCHAR(100) NOT NULL,
    `id_number` VARCHAR(20) NOT NULL,
    `date_of_birth` DATE NOT NULL,
    `gender` ENUM('Male','Female','Other') NOT NULL,
    `country` VARCHAR(50) DEFAULT NULL,
    `city` VARCHAR(50) DEFAULT NULL,
    `province` VARCHAR(50) DEFAULT NULL,
    `street` VARCHAR(100) DEFAULT NULL,
    `postal_code` VARCHAR(20) DEFAULT NULL,
    `income` DECIMAL(15, 2) DEFAULT NULL,
    `tax_number` VARCHAR(50) DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`client_id`)


-- 3. ACCOUNTS TABLE
-- Table structure for table `accounts`
DROP TABLE IF EXISTS `accounts`;
CREATE TABLE `accounts` (
    `account_number` VARCHAR(20) NOT NULL,
    `client_id` VARCHAR(50) NOT NULL,
    `product_code` VARCHAR(50) NOT NULL,
    `date_opened` DATE NOT NULL,
    `status` ENUM('Active','Closed','Frozen') DEFAULT 'Active',
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT '0.00',
    `daily_limit` DECIMAL(15, 2) DEFAULT NULL,
    `daily_spent` DECIMAL(15, 2) NOT NULL DEFAULT '0.00',
    `international_enabled` TINYINT(1) NOT NULL DEFAULT '0',
    `risk_score` INT DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`account_number`),
    KEY `client_id` (`client_id`),
    CONSTRAINT `accounts_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`client_id`) ON DELETE CASCADE


-- 4. FEES_SCHEDULE TABLE
-- Table structure for table `fees_schedule`
DROP TABLE IF EXISTS `fees_schedule`;
CREATE TABLE `fees_schedule` (
    `fee_id` INT NOT NULL AUTO_INCREMENT,
    `fee_code` VARCHAR(50) NOT NULL,
    `product_code` VARCHAR(10) NOT NULL,
    `fee_type` VARCHAR(20) NOT NULL,
    `amount_fixed` DECIMAL(10, 2) DEFAULT '0.00',
    `amount_percent` DECIMAL(10, 4) DEFAULT NULL,
    `min_fee` DECIMAL(10, 2) DEFAULT '0.00',
    `max_fee` DECIMAL(10, 2) DEFAULT NULL,
    `trigger_event` VARCHAR(50) NOT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT '1',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`fee_id`),
    UNIQUE KEY `uk_product_trigger` (`product_code`,`trigger_event`)


-- 5. FEE_LEDGER TABLE
-- Table structure for table `fee_ledger`
DROP TABLE IF EXISTS `fee_ledger`;
CREATE TABLE `fee_ledger` (
    `ledger_id` BIGINT NOT NULL AUTO_INCREMENT,
    `account_number` VARCHAR(20) NOT NULL,
    `fee_id` INT NOT NULL,
    `fee_code` VARCHAR(50) NOT NULL,
    `transaction_reference` VARCHAR(50) DEFAULT NULL,
    `charged_amount` DECIMAL(10, 2) NOT NULL,
    `charged_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    PRIMARY KEY (`ledger_id`),
    KEY `fk_ledger_fee_rule` (`fee_id`),
    CONSTRAINT `fk_ledger_fee_rule` FOREIGN KEY (`fee_id`) REFERENCES `fees_schedule` (`fee_id`)


-- 7. CARDS TABLE
-- Table structure for table `cards`
DROP TABLE IF EXISTS `cards`;
CREATE TABLE `cards` (
    `card_id` VARCHAR(50) NOT NULL,
    `account_number` VARCHAR(20) NOT NULL,
    `balance` DECIMAL(18, 2) NOT NULL DEFAULT '0.00',
    `product_code` VARCHAR(50) DEFAULT NULL,
    `pan` VARCHAR(16) NOT NULL,
    `pvv` VARCHAR(32) DEFAULT NULL,
    `masked_pan` VARCHAR(16) DEFAULT NULL,
    `exid` CHAR(16) NOT NULL,
    `cvv` VARCHAR(3) DEFAULT NULL,
    `expiry` VARCHAR(5) DEFAULT NULL,
    `emboss_name` VARCHAR(100) DEFAULT NULL,
    `status` ENUM('Active','Inactive','Blocked','Expired','Replaced') NOT NULL DEFAULT 'Inactive',
    `block_code` VARCHAR(10) DEFAULT NULL,
    `limit_amount` DECIMAL(15, 2) NOT NULL,
    `pin_set` ENUM('yes','no') DEFAULT 'no',
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `pin_attempts` INT NOT NULL DEFAULT '0',
    `txn_count_daily` INT NOT NULL DEFAULT '0',
    `max_pos_txn_daily` INT DEFAULT NULL,
    `is_mobile_token` TINYINT(1) NOT NULL DEFAULT '0',
    PRIMARY KEY (`card_id`),
    UNIQUE KEY `exid` (`exid`),
    KEY `account_number` (`account_number`),
    CONSTRAINT `cards_ibfk_1` FOREIGN KEY (`account_number`) REFERENCES `accounts` (`account_number`) ON DELETE CASCADE
) 