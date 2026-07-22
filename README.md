# StockPulse

StockPulse is a morning inventory tool for dairy distribution coordinators. Upload your inventory CSV and it instantly tells you which products need attention today — what to restock, what to clear before it expires, and what to hold off reordering. Everything runs in your browser; no server, no upload, no account.

## Running it

Open `index.html` directly in any modern browser (double-click it, or `open index.html` from the project folder). That's it — there's nothing to install or build.

## How it works, step by step

**1. Upload**
Drag a CSV onto the drop zone (or click it to browse), or click "Download sample CSV" first to get a ready-made file to try. The "Check inventory" button stays disabled until a file is selected.

**2. Scanning**
Clicking "Check inventory" reads the file entirely in your browser (via the FileReader API — the file never leaves your machine) and runs the calculations described below on every row.

**3. Results**
Products that need attention are grouped into three tabs — **Restock**, **Clear**, **Hold** — each showing a count. Click a tab to switch between categories. If nothing needs attention, you'll see "You're on top of it." instead.

Each flagged product shows:
- The product name and category
- A plain-English reason (e.g. "Runs out in 4 days. Order 60 units.")
- A large number showing the key figure (units to order, days left, or days of stock)
- A "View calculation" toggle that expands to show the exact numbers and arithmetic behind the flag, and a one-line explanation of why it was flagged
- A "Mark as reviewed" checkbox — checked items fade to half-opacity so you can track what you've already dealt with. The footer at the bottom shows "X of Y items reviewed" and switches to a "See you tomorrow morning" message once everything is reviewed.

Click "New upload" at any time to go back and check another file.

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

The file must have a header row with exactly these column names (case-sensitive):

```
product_name, category, quantity_on_hand, reorder_threshold, reorder_quantity, expiration_date, sales_rate
```

- `expiration_date` must be in `YYYY-MM-DD` format.
- Rows that are missing required values, have non-numeric quantities, or have an unparseable date are silently skipped — they don't stop the rest of the file from being processed.
- If the file is empty, has the wrong extension, is missing required columns, or has no valid rows at all, an inline error message explains what to fix.

`sample_inventory.csv` in this folder (or the "Download sample CSV" link on the upload page) contains a ready-to-use example with a mix of all three flags.

## Project files

```
stockpulse/
├── index.html   — page structure and markup for both the upload and results views
├── style.css    — all styling (Inter + Fraunces fonts, colors, layout, responsive rules)
├── app.js       — CSV parsing, the three calculations, and all interactivity
└── sample_inventory.csv — example file for testing
```

No frameworks, no build step, no dependencies beyond the Google Fonts import in `index.html`.
