-- ============================================================
-- KADAL TAREY — MySQL Database Schema
-- Run this file once to set up the database.
-- ============================================================

-- Create database
CREATE DATABASE IF NOT EXISTS kadal_tarey
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE kadal_tarey;

-- ── ORDERS TABLE ────────────────────────────────────────────
-- Stores one row per confirmed, verified order.
-- Orders are only inserted AFTER Razorpay signature verification.
CREATE TABLE IF NOT EXISTS orders (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id             VARCHAR(30)  NOT NULL UNIQUE,   -- e.g. KT-20240627-AB12CD
  mobile               VARCHAR(15)  NOT NULL,
  order_type           VARCHAR(20)  NOT NULL,           -- "Dine In" | "Takeaway"
  subtotal             DECIMAL(10,2) NOT NULL,
  gst                  DECIMAL(10,2) NOT NULL,
  total                DECIMAL(10,2) NOT NULL,
  payment_method       VARCHAR(30)  NOT NULL DEFAULT 'Online', -- upi, card, netbanking…
  razorpay_order_id    VARCHAR(50)  NOT NULL,
  razorpay_payment_id  VARCHAR(50)  NOT NULL,
  payment_status       ENUM('PAID','FAILED','PENDING') NOT NULL DEFAULT 'PENDING',
  order_status         ENUM('Pending','Preparing','Ready','Completed') NOT NULL DEFAULT 'Pending',
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_mobile     (mobile),
  INDEX idx_status     (order_status),
  INDEX idx_created    (created_at),
  INDEX idx_rzp_pay    (razorpay_payment_id)
) ENGINE=InnoDB;

-- ── ORDER ITEMS TABLE ────────────────────────────────────────
-- Stores each line item for an order.
CREATE TABLE IF NOT EXISTS order_items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id    VARCHAR(30)   NOT NULL,
  item_id     INT UNSIGNED  NOT NULL,
  item_name   VARCHAR(100)  NOT NULL,
  quantity    INT UNSIGNED  NOT NULL,
  unit_price  DECIMAL(10,2) NOT NULL,
  item_total  DECIMAL(10,2) NOT NULL,

  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  INDEX idx_order_id (order_id)
) ENGINE=InnoDB;

-- ── USEFUL VIEWS ─────────────────────────────────────────────

-- View: orders with their item list as JSON
CREATE OR REPLACE VIEW orders_full AS
SELECT
  o.*,
  JSON_ARRAYAGG(
    JSON_OBJECT(
      'item_id',   oi.item_id,
      'name',      oi.item_name,
      'quantity',  oi.quantity,
      'price',     oi.unit_price,
      'total',     oi.item_total
    )
  ) AS items_json
FROM orders o
LEFT JOIN order_items oi ON o.order_id = oi.order_id
GROUP BY o.id;

-- View: today's orders
CREATE OR REPLACE VIEW todays_orders AS
SELECT * FROM orders
WHERE DATE(created_at) = CURDATE()
ORDER BY created_at DESC;

-- View: revenue summary
CREATE OR REPLACE VIEW revenue_summary AS
SELECT
  DATE(created_at)         AS order_date,
  COUNT(*)                 AS total_orders,
  SUM(subtotal)            AS total_subtotal,
  SUM(gst)                 AS total_gst,
  SUM(total)               AS total_revenue
FROM orders
WHERE payment_status = 'PAID'
GROUP BY DATE(created_at)
ORDER BY order_date DESC;
