# Kadal Tarey — Full Stack Restaurant App

## What's Included

| File | Purpose |
|---|---|
| `kadal_tarey_frontend.html` | Complete restaurant website (menu, cart, invoice, tracker) |
| `kadal-tarey-backend/server.js` | Node.js + Express backend with Razorpay + MySQL |
| `kadal-tarey-backend/schema.sql` | MySQL database schema |
| `kadal-tarey-backend/package.json` | Backend dependencies |
| `kadal-tarey-backend/.env.example` | Environment variable template |

---

## Quick Setup (5 Steps)

### Step 1 — Get Razorpay API Keys
1. Sign up at [razorpay.com](https://razorpay.com)
2. Dashboard → Settings → API Keys → Generate Test Key
3. You get a **Key ID** (starts with `rzp_test_`) and **Key Secret**

### Step 2 — Set Up MySQL Database
```sql
-- In MySQL Workbench or terminal:
mysql -u root -p < schema.sql
```

### Step 3 — Configure Environment
```bash
cd kadal-tarey-backend
cp .env.example .env
# Edit .env with your actual Razorpay keys and DB credentials
```

### Step 4 — Start the Backend
```bash
cd kadal-tarey-backend
npm install
npm start
# Server runs at http://localhost:3000
```

### Step 5 — Update Frontend Config
In `kadal_tarey_frontend.html`, find this line near the top of the `<script>` section:

```javascript
const RAZORPAY_KEY_ID = "rzp_test_XXXXXXXXXXXXXXXX"; // ← REPLACE THIS
const API_BASE = ""; // same-origin; or "https://your-server.com"
```

- Replace `RAZORPAY_KEY_ID` with your actual Razorpay **Key ID** (the public one, not secret)
- Copy `kadal_tarey_frontend.html` into `kadal-tarey-backend/public/index.html`
- Or set `API_BASE` to your backend URL if running separately

---

## Payment Flow (Production)

```
User fills cart → clicks "Pay Now"
    ↓
Frontend → POST /api/create-order (backend creates Razorpay order)
    ↓
Razorpay Checkout opens (UPI / Card / Net Banking / Wallets)
    ↓
User pays in their UPI app / bank
    ↓
Razorpay returns: order_id + payment_id + signature to frontend
    ↓
Frontend → POST /api/verify-payment
    ↓
Backend verifies HMAC-SHA256 signature using secret key
    ↓
If verified → INSERT into MySQL orders + order_items
    ↓
Backend responds with orderId + paymentMethod
    ↓
Frontend renders professional invoice with PAID stamp ✓
```

**If payment fails or user cancels:**
- No order is created in the database
- Frontend shows "Payment Failed" banner
- No invoice is generated

---

## API Endpoints

### `POST /api/create-order`
Creates a Razorpay order (server-side).

**Request:**
```json
{
  "amount": 420,
  "currency": "INR",
  "mobile": "9876543210",
  "orderType": "Dine In",
  "items": [{ "id": 1, "name": "Chicken Sukka", "price": 160, "quantity": 2 }],
  "subtotal": 400,
  "gst": 20
}
```

**Response:**
```json
{
  "success": true,
  "razorpay_order_id": "order_XXXXXXXXXXXXXXXXXX",
  "amount": 42000,
  "currency": "INR",
  "key": "rzp_test_XXXXXXXXXXXXXXXX"
}
```

### `POST /api/verify-payment`
Verifies Razorpay signature and saves order in DB.

**Request:**
```json
{
  "razorpay_order_id": "order_XXX",
  "razorpay_payment_id": "pay_XXX",
  "razorpay_signature": "abc123...",
  "mobile": "9876543210",
  "orderType": "Dine In",
  "items": [...],
  "subtotal": 400,
  "gst": 20,
  "total": 420
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "KT-20240627-AB12CD",
  "paymentMethod": "upi",
  "message": "Payment verified and order saved."
}
```

### `GET /api/orders`
Returns all orders with items (for admin panel).

### `PATCH /api/orders/:orderId/status`
Updates order status. Body: `{ "status": "Preparing" }`

### `DELETE /api/orders/:orderId`
Deletes an order and its items.

### `GET /api/health`
Health check. Returns `{ status: "ok", db: "connected" }`.

---

## Going Live (Production Checklist)

- [ ] Switch Razorpay test keys → live keys (`rzp_live_...`)
- [ ] Set `FRONTEND_ORIGIN` in `.env` to your actual domain
- [ ] Use a process manager: `npm install -g pm2 && pm2 start server.js`
- [ ] Put behind nginx reverse proxy with HTTPS (Let's Encrypt)
- [ ] Set strong MySQL password
- [ ] Add rate limiting: `npm install express-rate-limit`
- [ ] Enable Razorpay webhooks for payment failure notifications
- [ ] Update `RESTAURANT` config in frontend HTML (address, GST number, phone)

---

## Demo Mode (No Backend)

If the frontend can't reach the backend (localhost not running), it automatically offers **demo mode** — simulating a payment success so you can preview the invoice UI without a live backend. This is clearly labelled and not suitable for production.
