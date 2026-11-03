# Domain Model

Conceptual model for the whole marketplace. Phases add tables only when they are built. Do not create all of these in Phase 1.

## Entities
| Entity | Description | Phase |
|--------|-------------|-------|
| User | Account with email, password hash, status | 2 |
| Role | customer, vendor, admin (a user can hold several) | 2 |
| Session / RefreshToken | Authentication state | 2 |
| VendorApplication | A user's business/store details, review state, and reviewer history | 3 |
| Store | A vendor's storefront (name, slug, description, contact phone, status) | 3 |
| Category | Hierarchical product categories with active/archived state | 4 |
| Product | Store-owned listing assigned to one or more categories | 4 |
| ProductVariant | Sellable option set (size, color), store-unique SKU and NGN price | 4 |
| ProductMedia | Object metadata for product images; storage upload adapter pending | 4 |
| InventoryItem | Stock level per variant | 5 |
| StockReservation | Temporary hold during checkout | 5 |
| Cart / CartItem | A customer's pending purchase across stores | 6 |
| Order | Customer's purchase (parent) | 7 |
| SubOrder | The part of an order belonging to one store | 7 |
| OrderItem | Line item, snapshot of price and product at purchase | 7 |
| Payment | One payment per order, with transaction attempt history and provider state | 8 |
| PaymentAttempt | One provider checkout initialization/verification attempt | 8 |
| PaymentWebhookEvent | Deduplication and hash-only audit metadata for provider callbacks | 8 |
| Refund | Partial/full money return with admin audit and provider status | 8 |
| CommissionRule | Effective-dated basis-point rate by store/category scope | 9 |
| LedgerEntry | Immutable vendor sale, commission, refund adjustment, or payout debit | 9 |
| Payout | Vendor payout request and manual transfer audit record | 9 |
| ShippingMethod / Shipment | Delivery options and tracking | 10 |
| Review | Customer rating for a product | 11 |
| Notification | Email or in-app message | 11 |

## Relationships (summary)
- User 1—N Role assignments
- User 1—0..1 Cart; Cart 1—N CartItem; CartItem N—1 ProductVariant
- User 1—N StockReservation; InventoryItem 1—N StockReservation
- Customer 1—N Order; Order 1—N SubOrder (one per store); SubOrder 1—N OrderItem
- User 1—N VendorApplication history; at most one may be pending
- User 1—0..1 Store (vendor); store owner and slug are unique
- Store 1—N Product; Product 1—N ProductVariant; Variant 1—1 InventoryItem
- Order 1—1 Payment
- Payment 1—N PaymentAttempt; Payment 1—N Refund
- Store 1—N CommissionRule; Store 1—N LedgerEntry; Store 1—N Payout
- SubOrder 1—N LedgerEntry; Payout 1—N LedgerEntry
- SubOrder 1—N LedgerEntry (sale, commission, refund adjustments)
- Store 1—N Payout

## Money rules
- Stored as integers in the smallest unit (kobo for NGN). Currency code stored beside every amount.
- Single currency at launch (NGN, assumption).
- Order items snapshot unit price, name, and SKU. Later product edits never change past orders.
- Commission is calculated at order payment confirmation and stored, not recomputed later.
- Ledger entries are append-only. Corrections are new entries.

## Order lifecycle
```
Order:     pending_payment -> paid -> (partially_fulfilled) -> completed
             \-> cancelled / payment_failed
SubOrder:  pending -> confirmed -> shipped -> delivered -> completed
                         \-> cancelled / refunded
```
Order status derives from its sub-orders once paid.

## Store status
`pending` -> `active` -> `suspended` (admin can suspend; suspended stores are hidden from browse and cannot sell).

## Multi-vendor rules
- A cart may contain items from many stores. Checkout creates one Order and one SubOrder per store.
- One payment covers the whole Order. Each vendor's share is tracked in the ledger.
- A vendor sees only their own SubOrders and ledger.
