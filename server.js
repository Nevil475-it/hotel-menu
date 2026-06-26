/**
 * ============================================================
 * KADAL TAREY — PRODUCTION BACKEND
 * Node.js + Express + MySQL + Razorpay
 * ============================================================
 *
 * ENDPOINTS:
 *   POST /api/create-order   — Create Razorpay order
 *   POST /api/verify-payment — Verify signature + save order in DB
 *   GET  /api/orders         — Get all orders (admin)
 *   PATCH /api/orders/:id/status — Update order status (admin)
 *   DELETE /api/orders/:id   — Delete order (admin)
 *
 * SETUP:
 *   1. Copy .env.example to .env and fill in your values
 *   2. Run the SQL in schema.sql to create the database
 *   3. npm install
 *   4. npm start
 * ============================================================
 */

require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const crypto   = require("crypto");
const Razorpay = require("razorpay");
const mysql    = require("mysql2/promise");
const path     = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

/* ---------- MIDDLEWARE ---------- */
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "*",
  methods: ["GET","POST","PATCH","DELETE"]
}));
app.use(express.json());

// Serve the frontend HTML as the root (optional)
app.use(express.static(path.join(__dirname, "public")));

/* ---------- RAZORPAY INSTANCE ---------- */
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ---------- MYSQL CONNECTION POOL ---------- */
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || "localhost",
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "kadal_tarey",
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0
});

/* ----------------------------------------------------------
   HELPER: generate a unique, readable order number
   Format: KT-YYYYMMDD-XXXXXX
   ---------------------------------------------------------- */
function generateOrderId(){
  const now = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g,"");
  const rand = Math.random().toString(36).slice(2,8).toUpperCase();
  return `KT-${date}-${rand}`;
}

/* ----------------------------------------------------------
   ENDPOINT 1: Create Razorpay Order
   POST /api/create-order
   Body: { amount, currency, mobile, orderType, items, subtotal, gst }
   Returns: { razorpay_order_id, amount (paise), currency, key }
   ---------------------------------------------------------- */
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", mobile, orderType, items, subtotal, gst } = req.body;

    // Validate required fields
    if(!amount || !mobile || !items || !items.length){
      return res.status(400).json({ success:false, message:"Missing required fields." });
    }

    if(isNaN(amount) || amount <= 0){
      return res.status(400).json({ success:false, message:"Invalid amount." });
    }

    // Razorpay expects amount in paise (1 INR = 100 paise)
    const amountPaise = Math.round(amount * 100);

    const rzpOptions = {
      amount:   amountPaise,
      currency: currency,
      receipt:  generateOrderId(),
      notes: {
        mobile:    mobile,
        orderType: orderType,
        itemCount: items.length
      }
    };

    const rzpOrder = await razorpay.orders.create(rzpOptions);

    console.log(`[CREATE-ORDER] Razorpay order created: ${rzpOrder.id} | Amount: ₹${amount} | Mobile: ${mobile}`);

    res.json({
      success:           true,
      razorpay_order_id: rzpOrder.id,
      amount:            rzpOrder.amount,   // paise
      currency:          rzpOrder.currency,
      key:               process.env.RAZORPAY_KEY_ID
    });

  } catch(err){
    console.error("[CREATE-ORDER ERROR]", err);
    res.status(500).json({ success:false, message: err.message || "Failed to create order." });
  }
});

/* ----------------------------------------------------------
   ENDPOINT 2: Verify Payment + Save Order in MySQL
   POST /api/verify-payment
   Body: {
     razorpay_order_id, razorpay_payment_id, razorpay_signature,
     mobile, orderType, items, subtotal, gst, total
   }
   Returns: { success, orderId, paymentMethod }

   SECURITY: We verify the HMAC signature using our secret key.
   NEVER trust the frontend to confirm payment.
   ---------------------------------------------------------- */
app.post("/api/verify-payment", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    mobile,
    orderType,
    items,
    subtotal,
    gst,
    total
  } = req.body;

  try {
    // ── Step 1: Verify Razorpay signature ──────────────────
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if(expectedSignature !== razorpay_signature){
      console.warn(`[VERIFY] SIGNATURE MISMATCH for order ${razorpay_order_id}`);
      return res.status(400).json({ success:false, message:"Payment verification failed: signature mismatch." });
    }

    console.log(`[VERIFY] Signature verified ✓ | Payment: ${razorpay_payment_id}`);

    // ── Step 2: Fetch payment details from Razorpay ────────
    let paymentMethod = "Online";
    try {
      const rzpPayment = await razorpay.payments.fetch(razorpay_payment_id);
      paymentMethod = rzpPayment.method || "Online";
      console.log(`[VERIFY] Payment method: ${paymentMethod}`);
    } catch(e){
      console.warn("[VERIFY] Could not fetch payment method:", e.message);
    }

    // ── Step 3: Save order in MySQL ────────────────────────
    const orderId = generateOrderId();
    const now     = new Date();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert into orders table
      const [orderResult] = await conn.execute(`
        INSERT INTO orders
          (order_id, mobile, order_type, subtotal, gst, total,
           payment_method, razorpay_order_id, razorpay_payment_id,
           payment_status, order_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', 'Pending', ?)`,
        [orderId, mobile, orderType, subtotal, gst, total,
         paymentMethod, razorpay_order_id, razorpay_payment_id, now]
      );

      // Insert each item into order_items table
      for(const item of items){
        await conn.execute(`
          INSERT INTO order_items
            (order_id, item_id, item_name, quantity, unit_price, item_total)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [orderId, item.id, item.name, item.quantity, item.price, item.price * item.quantity]
        );
      }

      await conn.commit();
      console.log(`[VERIFY] Order saved in DB: ${orderId}`);

    } catch(dbErr){
      await conn.rollback();
      throw dbErr;
    } finally {
      conn.release();
    }

    res.json({
      success:       true,
      orderId:       orderId,
      paymentMethod: paymentMethod,
      message:       "Payment verified and order saved."
    });

  } catch(err){
    console.error("[VERIFY-PAYMENT ERROR]", err);
    res.status(500).json({ success:false, message: err.message || "Payment verification failed." });
  }
});

/* ----------------------------------------------------------
   ENDPOINT 3: Get All Orders (Admin)
   GET /api/orders
   Returns: [ { order + items[] } ]
   ---------------------------------------------------------- */
app.get("/api/orders", async (req, res) => {
  try {
    const [orders] = await pool.execute(
      "SELECT * FROM orders ORDER BY created_at DESC"
    );

    // Fetch items for each order
    for(const order of orders){
      const [items] = await pool.execute(
        "SELECT * FROM order_items WHERE order_id = ?",
        [order.order_id]
      );
      order.items = items;
    }

    res.json({ success:true, orders });

  } catch(err){
    console.error("[GET-ORDERS ERROR]", err);
    res.status(500).json({ success:false, message: err.message });
  }
});

/* ----------------------------------------------------------
   ENDPOINT 4: Update Order Status (Admin)
   PATCH /api/orders/:orderId/status
   Body: { status }
   ---------------------------------------------------------- */
app.patch("/api/orders/:orderId/status", async (req, res) => {
  const { orderId }  = req.params;
  const { status }   = req.body;
  const validStatuses = ["Pending","Preparing","Ready","Completed"];

  if(!validStatuses.includes(status)){
    return res.status(400).json({ success:false, message:"Invalid status value." });
  }

  try {
    await pool.execute(
      "UPDATE orders SET order_status = ? WHERE order_id = ?",
      [status, orderId]
    );
    console.log(`[STATUS] Order ${orderId} → ${status}`);
    res.json({ success:true, message:"Status updated." });

  } catch(err){
    console.error("[STATUS ERROR]", err);
    res.status(500).json({ success:false, message: err.message });
  }
});

/* ----------------------------------------------------------
   ENDPOINT 5: Delete Order (Admin, only Completed orders)
   DELETE /api/orders/:orderId
   ---------------------------------------------------------- */
app.delete("/api/orders/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    await pool.execute("DELETE FROM order_items WHERE order_id = ?", [orderId]);
    await pool.execute("DELETE FROM orders WHERE order_id = ?", [orderId]);
    console.log(`[DELETE] Order ${orderId} deleted`);
    res.json({ success:true, message:"Order deleted." });

  } catch(err){
    console.error("[DELETE ERROR]", err);
    res.status(500).json({ success:false, message: err.message });
  }
});

/* ----------------------------------------------------------
   HEALTH CHECK
   ---------------------------------------------------------- */
app.get("/api/health", async (req, res) => {
  try {
    await pool.execute("SELECT 1");
    res.json({ status:"ok", db:"connected", timestamp: new Date() });
  } catch(e){
    res.status(500).json({ status:"error", db:"disconnected", error: e.message });
  }
});

/* ---------- START SERVER ---------- */
app.listen(PORT, () => {
  console.log(`\n🐟 Kadal Tarey Backend running on http://localhost:${PORT}`);
  console.log(`   Razorpay Key: ${process.env.RAZORPAY_KEY_ID || "(not set)"}`);
  console.log(`   DB: ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);
});
