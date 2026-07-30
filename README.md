# StockPulse

StockPulse is a morning inventory tool for dairy distribution coordinators. It reads today's inventory automatically — no upload, no login — and tells you what needs attention right now: what to restock, what to clear before it expires, and what to leave alone. A per-product FEFO (First-Expired-First-Out) view shows exactly which physical lot to move first, and a historical Insights view breaks down four years of sales and spoilage data. Everything runs in the browser; no server, no account, no build step.

This is a client-side demo milestone of a larger planned platform (see `Dairy Inventory MVP Strategy.md`): a future phase adds a real backend, live inventory sync, and alerts, but the calculations and views here carry over unchanged.

## Running it

Serve the folder with any static file server and open it in a browser, for example:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000/index.html`. A local server is recommended because the app loads its data with `fetch()`, which Chrome and most Chromium-based browsers block when a page is opened directly via `file://` (Firefox is more permissive and may work either way). There's nothing to install — no npm, no dependencies beyond the Google Fonts and Chart.js CDN links already in `index.html`.

## Data

On load, StockPulse fetches two CSVs from the project root and never modifies either:

- **`today_data.csv`** — a snapshot of today's inventory (40 batches) that drives the Dashboard and FEFO views.
- **`historical_data.csv`** — four years of daily inventory records (2019–2022, ~2,200 rows) that drives the Insights charts.

Both are plain CSVs with a header row; see the column list at the bottom of this file.

## The four views

**Landing** — the entry screen. Three live stat cards (products expiring this week, products below minimum stock, batches needing action today) are computed from today's data as soon as it loads. Click "Open dashboard →" — or the StockPulse logo, which is clickable from anywhere in the app and always returns to the dashboard — to get to work.

**Dashboard (Today's Inventory)** — the main working view:
- An **AI Morning Briefing** panel summarizes the day in a few sentences. By default this is a rule-based sentence built from real numbers (expired count, urgent count, top priority item); see [AI Briefing](#ai-briefing) below for the optional live-API mode.
- Three **summary cards** (Restock / Clear / Hold) show how many items in each category are still awaiting review, with a "X of Y reviewed" progress line and a click-to-filter behavior.
- An **expiry timeline** bar segments all 40 items into Expired, Urgent (0–3 days), Expiring Soon (4–7 days), and Safe (8+ days) — click a segment to filter the feed to that band.
- An **Urgent Lots table** ranks every Restock/Clear item by priority (financial exposure weighted by urgency), capped at the top 10 with a "Show all N" expand so the table stays readable no matter how large the inventory grows. Each row shows the plain-English reason it's flagged and a "Mark as reviewed" button.
- A **product feed** with six tabs — Needs Action (the default), Restock, Clear, Hold, Reviewed, and All — each showing a live count. Needs Action, Restock, Clear, and Hold all exclude items you've already reviewed; the Reviewed tab is where those live, and All is the one true "browse everything" view. Each card shows the reason, a labeled key number (e.g. "28 · liters to order"), and an expandable "View details" panel with the underlying figures.

**Historical Insights** — four Chart.js charts built from `historical_data.csv`: monthly sales volume (line), total units sold by brand (horizontal bar with value labels), sales by channel (doughnut with percentage legend), and historically expired units by product (bar).

**FEFO Matrix** — opened by clicking any product name. Shows a shelf-life bar (share of stock that's Expired/Critical, Expiring Soon, or Safe) and a lot table sorted soonest-to-expire first, so you know exactly which batch to move before which. "Print pick list" opens the browser's print dialog with everything but the lot table hidden.

## Marking items reviewed

Each item has a "Mark as reviewed" button (feed cards and the Urgent Lots table both use it, kept in sync). Clicking it plays a brief in-place confirm animation, then the item moves to the Reviewed tab — clicking it again there undoes it, moving the item back. Review state is saved to `localStorage` under a date-scoped key, so it survives a page refresh but naturally resets once the next day's `today_data.csv` is in place. The sticky footer at the bottom of the dashboard tracks "X of Y action items reviewed" and switches to a completion message once every Restock/Clear item has been handled.

## What Restock, Clear, and Hold mean

For every row in `today_data.csv`, StockPulse computes:

| Term | Formula |
|---|---|
| `sales_rate` | `quantity_sold / 30` |
| `days_remaining` | `quantity_in_stock / sales_rate` (999 if `sales_rate` is 0) |
| `units_expiring_unsold` | `quantity_in_stock - (sales_rate * max(days_until_expiration, 0))` |
| `normal_cycle` | `minimum_stock_threshold / sales_rate` (999 if `sales_rate` is 0) |

Checked in this order, first match wins:

- **Restock** — `days_remaining` is 5 days or fewer. *"Runs out in X days. Order Y [unit]."*
- **Clear** — `units_expiring_unsold` is greater than 0 **and** `days_until_expiration` is 7 days or fewer (already-expired stock qualifies too — shown as *"already expired X days ago"* rather than a confusing negative day count). *"X [unit] already expired Y days ago"* or *"X [unit] expire in Y days before they sell."*
- **Hold** — `days_remaining` is more than double `normal_cycle`. *"X days of stock. Skip reorder this cycle."*
- If none apply, the item carries no flag and needs no action.

A **priority** score ranks flagged items for the Urgent Lots table: `(quantity_in_stock * reorder_quantity) / max(days_until_expiration, 1)`, or `quantity_in_stock * reorder_quantity * 1000` for already-expired stock, so the most financially exposed and most urgent items sort to the top.

## AI Briefing

At the top of `app.js`:

```js
const CONFIG = {
  USE_AI_BRIEFING: false,    // true = Anthropic API  |  false = rule-based (free, instant)
  AI_DAILY_LIMIT: 3,         // per-browser daily cap (localStorage). Only used when USE_AI_BRIEFING: true
  ANTHROPIC_API_KEY: '',     // paste key here to bake it in, or leave blank for user-input field
};
```

Flip `USE_AI_BRIEFING` to `true` to have the briefing generated by the Anthropic API instead of the rule-based sentence builder — that's the only code change needed. With no key baked into `ANTHROPIC_API_KEY`, the dashboard shows a small inline field to paste one in (stored in `sessionStorage`, not persisted beyond the tab). Usage is capped per browser per day via `AI_DAILY_LIMIT`; once the cap is hit, or if the API call fails for any reason (network, auth, rate limit), StockPulse silently falls back to the rule-based briefing — no error is ever shown to the user.

## CSV format

Both files share the same core columns (`historical_data.csv` adds two more):

```
batch_id, inventory_date, product_name, brand, unit, packaging_type, sales_channel,
production_date, expiration_date, quantity_received, quantity_sold, quantity_in_stock,
expected_stock, stock_discrepancy, minimum_stock_threshold, reorder_quantity,
days_until_expiration
```

`historical_data.csv` additionally has `stock_status` and `expiration_status` columns (used to compute historical spoilage in the Insights view). Dates are `YYYY-MM-DD`; there are no quoted fields, so parsing is a plain comma split.

## Project files

```
stockpulse/
├── index.html           — markup for all four views (Landing, Dashboard, Insights, FEFO Matrix)
├── style.css             — design system, layout, responsive and print rules
├── app.js                 — CONFIG flag, CSV parsing, calculations, rendering, AI briefing, charts
├── favicon.svg            — browser tab icon (also used as the in-app logo mark)
├── today_data.csv         — today's inventory snapshot (read-only input)
└── historical_data.csv    — 2019–2022 historical records (read-only input)
```

No frameworks, no build step. The only external dependencies are the Google Fonts and Chart.js CDN `<script>`/`<link>` tags already in `index.html`.
