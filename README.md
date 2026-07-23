# StockPulse

StockPulse is a morning inventory tool for dairy distribution coordinators. Upload your inventory CSV and it instantly tells you which products need attention today — what to restock, what to clear before it expires, and what to hold off reordering — plus a per-product FEFO breakdown when you need to see which specific lot is driving the flag. Everything runs in your browser; no server, no upload, no account.

This is the client-side MVP milestone of a larger planned platform (see `Dairy Inventory MVP Strategy.md`): a future phase adds a real backend, live Google Sheets sync, and SMS/email alerts, but the calculations and views here carry over unchanged.

## Running it

Open `index.html` directly in any modern browser (double-click it, or `open index.html` from the project folder). That's it — there's nothing to install or build.

## How it works, step by step

**1. Upload**
Drag a CSV onto the drop zone (or click it to browse), or click "Download sample CSV" first to get a ready-made file to try. The "Check inventory" button stays disabled until a file is selected.

**2. Scanning**
Clicking "Check inventory" reads the file entirely in your browser (via the FileReader API — the file never leaves your machine) and runs the calculations described below on every row.

**3. Results (the morning dashboard)**
At the top, three summary cards show how many products are flagged Restock, Clear, and Hold — click a card to jump straight to that tab. Below, the same three tabs group every flagged product, each showing a count. If nothing needs attention, you'll see "You're on top of it." instead.

Each flagged product shows:
- The product name (click it to open the FEFO Matrix for that product — see below) and category
- If the file has multiple rows (lots) for the same product, a small "Lot ... • Bin ..." line identifying which lot triggered this flag
- A plain-English reason (e.g. "Runs out in 4 days. Order 60 units.")
- A large number showing the key figure (units to order, days left, or days of stock)
- A "View calculation" toggle that expands to show the exact numbers and arithmetic behind the flag, and a one-line explanation of why it was flagged
- A "Mark as reviewed" checkbox — checked items fade to half-opacity so you can track what you've already dealt with. The footer at the bottom shows "X of Y items reviewed" and switches to a "See you tomorrow morning" message once everything is reviewed.

Click "New upload" at any time to go back and check another file.

**4. The FEFO Matrix (per-product lot view)**
Clicking any product name opens its FEFO (First-Expired-First-Out) Matrix: a shelf-life bar showing what share of that product's total stock is Red (expiring in 2 days or less, or already expired), Yellow (3–7 days), or Green (more than 7 days) — followed by a table of every lot for that product, sorted soonest-to-expire first, with lot number, storage bin, quantity, expiration date, and days-to-expiry. This surfaces risk that a product-level total can hide: a product can look fine on aggregate (plenty of total stock) while one specific lot is quietly about to expire unsold. Click "Back" to return to the dashboard.

## What Restock, Clear, and Hold mean

- **Restock** — this product is about to run out. Order more now.
- **Clear** — this product will expire before it sells through at the current pace. Move it or discount it now.
- **Hold** — this product has more than enough stock for its normal reorder cycle. Skip ordering it this time.

A product only ever gets one flag, checked in that priority order (Restock beats Clear beats Hold). If none of the rules apply, the product simply doesn't appear — it's fine as-is.

## The calculations

For every valid row, StockPulse computes:

| Term | Formula |
|---|---|
| `days_remaining` | `quantity_on_hand / sales_rate` |
| `days_until_expiry` | days between today and `expiration_date` |
| `units_expiring_unsold` | `quantity_on_hand - (sales_rate * days_until_expiry)` |
| `normal_cycle` | `reorder_threshold / sales_rate` |

**Restock** — flagged if `days_remaining` is 5 days or fewer.
> Reason shown: "Runs out in X days. Order Y units." (Y = `reorder_quantity` from the CSV)

**Clear** — flagged if `units_expiring_unsold` is greater than 0 **and** `days_until_expiry` is 7 days or fewer.
> Reason shown: "X units expire in Y days before they sell."

**Hold** — flagged if `days_remaining` is more than double `normal_cycle`.
> Reason shown: "X days of stock. Skip reorder this cycle."

These three checks run in order (Restock, then Clear, then Hold) and stop at the first match, so a product is never flagged twice.

## CSV format

The file must have a header row including at least these required column names (case-sensitive):

```
product_name, category, quantity_on_hand, reorder_threshold, reorder_quantity, expiration_date, sales_rate
```

Two extra columns are optional and power the FEFO Matrix:

```
lot_number, storage_bin
```

If you omit them, StockPulse auto-generates a lot number (`LOT-1`, `LOT-2`, ...) and a placeholder bin (`—`) per row, so existing files without these columns still work unchanged.

- `expiration_date` must be in `YYYY-MM-DD` format.
- Rows that are missing required values, have non-numeric quantities, or have an unparseable date are silently skipped — they don't stop the rest of the file from being processed.
- If the file is empty, has the wrong extension, is missing required columns, or has no valid rows at all, an inline error message explains what to fix.
- A product can appear on more than one row if it has multiple active lots (different batches with different expiration dates/quantities). Each lot row is still flagged independently for Restock/Clear/Hold, and all of a product's lots roll up together into its FEFO Matrix.

`sample_inventory.csv` in this folder (or the "Download sample CSV" link on the upload page) contains a ready-to-use example with a mix of all three flags, including one product (Skim Milk 1L) split across two lots to demonstrate the FEFO Matrix.

## Project files

```
stockpulse/
├── index.html   — page structure and markup for the upload, results/dashboard, and FEFO Matrix views
├── style.css    — all styling (Inter + Fraunces fonts, colors, layout, responsive rules)
├── app.js       — CSV parsing, the FEFO catalog, the three calculations, and all interactivity
└── sample_inventory.csv — example file for testing, including a two-lot product
```

No frameworks, no build step, no dependencies beyond the Google Fonts import in `index.html`.
