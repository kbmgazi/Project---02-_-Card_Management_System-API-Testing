# Scope & Acceptance Criteria — Card Issuing & Lifecycle

## Features (in-scope)
1. Create Card (virtual / physical)
   - Request: POST /card/create
   - Request body: { customer_id, card_type, product_type }
   - Success: 201 + JSON { card_id, status: "created" }
2. Activate Card
   - Request: POST /card/activate
   - Body: { card_id }
   - Success: 200 + status changed to "active"
3. PIN Set / PIN Change
   - Request: POST /card/pin
   - Body: { card_id, pin }
   - Success: 200 + pin_set: true
4. Card Freeze / Unfreeze
   - Freeze: POST /card/freeze -> status: "blocked"
   - Unfreeze: POST /card/unfreeze -> status: "active"
5. Card Limit Change (increase / decrease)
   - Request: POST /card/limits
   - Body: { card_id, limit_amount }
   - Success: 200 + limit_amount reflected in DB
6. Card Status Updates
   - Allowed transitions example: active → blocked → closed
   - Invalid transitions should return 4xx with descriptive message

## Out-of-scope (Day 1)
- Real card issuing with network tokens
- Hardware card printing workflows
- 3DS / payments processing
