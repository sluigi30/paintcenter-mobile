// ─────────────────────────────────────────────────────────────
// Shared order vocabulary for the Orders tab and the order detail.
//
// Orders are NEVER shown to customers by id. Ids are a shared
// auto-increment across every customer, so a first-time buyer seeing
// "#147" wonders what happened to their other 146 orders. The placed-at
// date and time is the identity instead — keep it that way in any new
// customer-facing copy.
// ─────────────────────────────────────────────────────────────

/**
 * Customer-facing wording for each status. `label` is the badge; `headline`
 * and `blurb` front the detail screen. Deliberately warmer than the raw
 * status — "shipped" reads as "Out for Delivery" to the person waiting.
 */
export const STATUS_META = {
  pending: {
    label:    'Pending',
    color:    '#b45309',
    tint:     '#fffbeb',
    icon:     'time-outline',
    headline: 'Order Placed',
    blurb:    "We've received your order and will confirm it shortly.",
  },
  processing: {
    label:    'Processing',
    color:    '#1d4ed8',
    tint:     '#eff6ff',
    icon:     'cube-outline',
    headline: 'Preparing Your Order',
    blurb:    'Your items are being picked and packed at the store.',
  },
  shipped: {
    label:    'Shipped',
    color:    '#6d28d9',
    tint:     '#f5f3ff',
    icon:     'car-outline',
    headline: 'Out for Delivery',
    blurb:    'Your order has left the store and is on its way to you.',
  },
  ready_for_pickup: {
    label:    'Ready for Pickup',
    color:    '#6d28d9',
    tint:     '#f5f3ff',
    icon:     'storefront-outline',
    headline: 'Ready for Pickup',
    blurb:    'Your order is packed and waiting for you at the store.',
  },
  completed: {
    label:    'Completed',
    color:    '#15803d',
    tint:     '#f0fdf4',
    icon:     'checkmark-circle-outline',
    headline: 'Order Completed',
    blurb:    'Thank you for shopping with NCM Paint Center.',
  },
  cancelled: {
    label:    'Cancelled',
    color:    '#dc2626',
    tint:     '#fef2f2',
    icon:     'close-circle-outline',
    headline: 'Order Cancelled',
    blurb:    'This order was cancelled and the items returned to stock.',
  },
};

export const statusMeta = (status) =>
  STATUS_META[status] ?? {
    label:    String(status ?? '').replace(/_/g, ' '),
    color:    '#6b7280',
    tint:     '#f9fafb',
    icon:     'ellipse-outline',
    headline: 'Order Update',
    blurb:    '',
  };

/** Mirrors PAYMENT_METHODS in app/checkout.jsx — keep the two in step. */
export const PAYMENT_LABELS = {
  cod:   'Cash on Delivery',
  gcash: 'GCash',
  card:  'Credit/Debit Card',
  cash:  'Cash (Pickup)',
};

export const PAYMENT_STATUS_COLORS = {
  pending:  '#b45309',
  paid:     '#15803d',
  failed:   '#dc2626',
  refunded: '#6d28d9',
};

// Mirrors Order::CUSTOMER_CANCEL_REASONS on the API. The server accepts any
// string (Other is free text), so these are presentation only — but keep the
// two lists in step so customers and admins read the same vocabulary.
export const CANCEL_REASONS = [
  'Changed my mind',
  'Ordered the wrong item or size',
  'Found a better price elsewhere',
  'Taking too long to arrive',
  'Wrong delivery address',
];

/**
 * How often a FOCUSED orders screen re-checks the API.
 *
 * The store can cancel or advance an order from the admin panel at any moment,
 * and a customer sitting on the screen has no other way to find out. Slower
 * than the 5s messages poll on purpose: an order payload carries every line
 * item and product, and statuses change far less often than chat messages.
 */
export const ORDER_POLL_MS = 10000;

/** An order can only be called off while the store has not dispatched it. */
export const CAN_CANCEL_STATUSES = ['pending', 'processing'];

export const canCancel = (order) => CAN_CANCEL_STATUSES.includes(order?.status);

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

/**
 * Laravel serialises casted dates as ISO-8601, but an uncasted `datetime`
 * column arrives as "2026-08-18 06:52:09" — which Hermes parses as Invalid
 * Date. Normalise before handing anything to Date, so a missing cast on the
 * API side degrades to a dash rather than "NaN".
 */
const toDate = (value) => {
  if (!value) return null;
  const date = new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const DATE_OPTS = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_OPTS = { hour: 'numeric', minute: '2-digit' };

/** "18 Aug 2026 · 2:41 PM" — the customer-facing name of an order. */
export const formatOrderDate = (value) => {
  const date = toDate(value);
  if (!date) return '—';
  return `${date.toLocaleDateString(undefined, DATE_OPTS)} · ${date.toLocaleTimeString(undefined, TIME_OPTS)}`;
};

/** "18 Aug 2026" — where the time would only add noise. */
export const formatDateOnly = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString(undefined, DATE_OPTS) : '—';
};

/** "2:41 PM" */
export const formatTimeOnly = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleTimeString(undefined, TIME_OPTS) : '—';
};

/** "Today", "Yesterday", else the plain date — the list card's date line. */
export const relativeDay = (value) => {
  const date = toDate(value);
  if (!date) return '—';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, DATE_OPTS);
};

/** The date an order is known by: admin-editable order_date, else created_at. */
export const placedAt = (order) => order?.order_date || order?.created_at;

// ─────────────────────────────────────────────────────────────
// Progress tracker
// ─────────────────────────────────────────────────────────────

/**
 * The steps an order walks through. Delivery and pickup diverge at the third
 * step, and each ends with a differently worded completion.
 */
const FLOW = {
  delivery: [
    { key: 'pending',    title: 'Order Placed',     note: 'We received your order' },
    { key: 'processing', title: 'Processing',       note: 'Packing your items' },
    { key: 'shipped',    title: 'Out for Delivery', note: 'On the way to you' },
    { key: 'completed',  title: 'Delivered',        note: 'Order complete' },
  ],
  pickup: [
    { key: 'pending',          title: 'Order Placed',    note: 'We received your order' },
    { key: 'processing',       title: 'Processing',       note: 'Packing your items' },
    { key: 'ready_for_pickup', title: 'Ready for Pickup', note: 'Waiting at the store' },
    { key: 'completed',        title: 'Picked Up',        note: 'Order complete' },
  ],
};

/**
 * Builds the tracker for an order.
 *
 * Only two timestamps actually exist per order — when it was placed and when
 * it was cancelled — so an intermediate step carries a time only while it is
 * the current one (from updated_at). Steps we cannot date are left blank
 * rather than given a plausible-looking guess.
 */
export const orderTimeline = (order) => {
  if (!order) return [];

  const flow   = FLOW[order.order_type] ?? FLOW.delivery;
  const placed = placedAt(order);

  if (order.status === 'cancelled') {
    return [
      { key: 'pending', title: 'Order Placed', note: 'We received your order', at: placed, state: 'done' },
      {
        key:   'cancelled',
        title: 'Cancelled',
        note:  order.cancellation_reason || 'Order cancelled',
        at:    order.cancelled_at,
        state: 'cancelled',
      },
    ];
  }

  const current = flow.findIndex((step) => step.key === order.status);

  return flow.map((step, i) => ({
    ...step,
    // An unrecognised status leaves current at -1; treat only the first step
    // as live so the tracker never claims progress the order has not made.
    state: current === -1
      ? (i === 0 ? 'current' : 'upcoming')
      : i < current ? 'done' : i === current ? 'current' : 'upcoming',
    at: i === 0 ? placed : (i === current ? order.updated_at : null),
  }));
};
