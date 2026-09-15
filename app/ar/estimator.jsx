import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { API_URL } from '../../constants/api';
import { useAuthStore } from '../../stores/authStore';
import { useMeasureStore } from '../../stores/measureStore';

/**
 * Paint calculator — "how much of THIS paint do I need?"
 *
 * A generic web paint calculator has to ask for paint type, substrate and
 * finish, because it has no idea what you are about to buy. This one is nearly
 * always opened from a product page, so the brand, the paint and the can sizes
 * are already known — which is why the questions here are only the ones that
 * actually move a number, and why the answer is not "12.4 litres" but a set of
 * cans at real prices that goes into the cart.
 *
 * Two entry points, both supported:
 *   - from a product    -> `productId` (+ `hex`); sizes, prices and stock are
 *                          fetched fresh, because a plan built on a cached
 *                          price is a plan the cart will disagree with.
 *   - from AR measuring -> `width` / `height`, which prefill wall 1.
 *
 * The AR wall measurement is an *input* to this screen, not a gate in front of
 * it: any wall row can hand off to it, and the reading comes back through
 * `measureStore` (see the note there for why not through params).
 */

// How far one litre goes over ONE coat, in m². Substrate and condition are two
// questions on paper but a homeowner answers them as one — and both only exist
// to pick this number — so they are one question here. The figures are the
// usual trade spread rates; the low end for thirsty surfaces is what stops a
// bare-block wall being under-bought by a third.
const SURFACES = [
  { key: 'smooth',   label: 'Smooth wall',              hint: 'Sealed, even finish — plastered or already painted', rate: 12 },
  { key: 'concrete', label: 'Bare concrete or masonry', hint: 'New plaster, skim coat, hollow block',     rate: 9  },
  { key: 'rough',    label: 'Rough or porous',          hint: 'Textured, unsealed, very absorbent',       rate: 7  },
  { key: 'wood',     label: 'Wood',                     hint: 'Doors, panels, plywood',                   rate: 11 },
  { key: 'metal',    label: 'Metal',                    hint: 'Gates, grills, roofing',                   rate: 13 },
];

// Openings start at the usual sizes so the common case is still "count them,
// don't measure them" — but they are a STARTING POINT, not a fact. A PH house
// with a 2.4 m sliding door or jalousie strips nothing like a standard window
// would otherwise have its openings mis-deducted, and openings come straight
// off the paint you buy.
const DEFAULT_DOOR   = { w: '0.9', h: '2.1' };
const DEFAULT_WINDOW = { w: '1.2', h: '1.0' };

const COATS = [
  { value: 1, hint: 'Touch-up, same colour' },
  { value: 2, hint: 'Recommended' },
  { value: 3, hint: 'Dark over light' },
];

// Anything that is not a positive number is a zero here — a half-typed "3."
// must read as "nothing yet", never as a NaN leaking into the total.
const num = (s) => {
  const n = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const peso = (n) => `₱${Math.round(n).toLocaleString()}`;

// Sizes are stored as free text ("1L", "4L"). Parse rather than trust: a size
// nobody can measure is left out of the plan instead of counting as zero
// litres, which would make it look like infinitely good value.
const parseLiters = (size) => {
  const s = String(size ?? '').toLowerCase();
  const ml = s.match(/([\d.]+)\s*ml/);
  if (ml) return parseFloat(ml[1]) / 1000;
  const gal = s.match(/([\d.]+)?\s*gal/);
  if (gal) return (gal[1] ? parseFloat(gal[1]) : 1) * 3.785;
  const l = s.match(/([\d.]+)\s*l/);
  if (l) return parseFloat(l[1]);
  return 0;
};

/**
 * Turn a litre requirement into actual cans of this product.
 *
 * Best value first, not biggest first. A 4L is usually cheaper per litre than
 * four 1L — but that is a fact about the price list, and the price list is
 * editable in the admin. Sorting by price-per-litre keeps the plan the cheapest
 * one whatever the shop does to its prices.
 *
 * The remainder is then closed by the SMALLEST can that still covers it, so
 * nobody is sold a 4L to finish off 0.3 L.
 *
 * Every size is capped by its own stock, so the plan is one that can actually
 * be bought today; if stock runs out before the litres do, `short` says by how
 * much rather than the screen quietly promising paint that isn't there.
 */
function planPacks(litersNeeded, variants) {
  const sizes = (variants ?? [])
    .map((v) => ({
      variant: v,
      size:    v.size_volume,
      liters:  parseLiters(v.size_volume),
      price:   parseFloat(v.price),
      stock:   v.stock ?? 0,
    }))
    .filter((s) => s.liters > 0 && s.stock > 0 && Number.isFinite(s.price));

  if (!sizes.length) return null;

  const byValue = [...sizes].sort((a, b) => a.price / a.liters - b.price / b.liters);
  const bySize  = [...sizes].sort((a, b) => a.liters - b.liters);

  const taken = new Map();                       // size row -> can count
  const used  = (s) => taken.get(s) ?? 0;
  let remaining = litersNeeded;

  for (const s of byValue) {
    if (remaining <= 0) break;
    const n = Math.min(Math.floor(remaining / s.liters), s.stock);
    if (n > 0) { taken.set(s, n); remaining -= n * s.liters; }
  }

  // Close the gap. Each pass either covers the remainder outright or takes at
  // least one more can of the largest size still in stock, so this terminates.
  while (remaining > 0.001) {
    const exact    = bySize.find((s) => s.liters >= remaining - 0.001 && s.stock > used(s));
    const fallback = [...bySize].reverse().find((s) => s.stock > used(s));
    const pick = exact ?? fallback;
    if (!pick) break;                            // nothing left to buy
    const n = Math.min(Math.ceil(remaining / pick.liters), pick.stock - used(pick));
    taken.set(pick, used(pick) + n);
    remaining -= n * pick.liters;
  }

  const lines = [...taken.entries()]
    .map(([s, count]) => ({
      variant: s.variant,
      size:    s.size,
      liters:  s.liters,
      count,
      cost:    s.price * count,
    }))
    .sort((a, b) => b.liters - a.liters);

  return {
    lines,
    liters: lines.reduce((t, l) => t + l.liters * l.count, 0),
    cost:   lines.reduce((t, l) => t + l.cost, 0),
    short:  Math.max(0, remaining),
  };
}

// ── Small pieces, kept at module scope so a re-render never remounts them
//    (a remounted TextInput drops the keyboard mid-digit) ─────────────────
function Section({ step, title, hint, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHead}>
        <View style={styles.stepDot}><Text style={styles.stepNum}>{step}</Text></View>
        <View style={styles.sectionHeadText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

function WallRow({ index, wall, canDelete, onChange, onDelete, onMeasure }) {
  const area = num(wall.w) * num(wall.h);

  return (
    <View style={styles.wallRow}>
      <Text style={styles.wallLabel}>Wall {index + 1}</Text>

      <View style={styles.wallInputs}>
        <View style={styles.dimBox}>
          <TextInput
            style={styles.dimInput}
            placeholder="0"
            placeholderTextColor="#c4c4c4"
            keyboardType="decimal-pad"
            value={wall.w}
            onChangeText={(t) => onChange(wall.id, { w: t })}
          />
          <Text style={styles.dimUnit}>m</Text>
        </View>

        <Text style={styles.times}>×</Text>

        <View style={styles.dimBox}>
          <TextInput
            style={styles.dimInput}
            placeholder="0"
            placeholderTextColor="#c4c4c4"
            keyboardType="decimal-pad"
            value={wall.h}
            onChangeText={(t) => onChange(wall.id, { h: t })}
          />
          <Text style={styles.dimUnit}>m</Text>
        </View>

        <TouchableOpacity style={styles.iconBtn} onPress={() => onMeasure(wall.id)}>
          <Ionicons name="scan-outline" size={18} color="#b91c1c" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => onDelete(wall.id)}
          disabled={!canDelete}
        >
          <Ionicons name="trash-outline" size={18} color={canDelete ? '#999' : '#e5e5e5'} />
        </TouchableOpacity>
      </View>

      {area > 0 && <Text style={styles.wallArea}>{area.toFixed(2)} m²</Text>}
    </View>
  );
}

/**
 * A count AND the size of one, because neither alone is enough: a standard door
 * is a fine default and a wrong answer for the sliding one in the living room.
 *
 * The size inputs appear once there is something to size — at zero they would
 * be two empty boxes asking about openings the user does not have.
 */
function OpeningRow({ label, opening, onChange }) {
  const each = num(opening.w) * num(opening.h);

  return (
    <View>
      <Counter
        label={label}
        hint={each > 0 ? `${each.toFixed(2)} m² each` : 'Enter a size below'}
        value={opening.count}
        onChange={(count) => onChange({ ...opening, count })}
      />

      {opening.count > 0 && (
        <View style={styles.openingSize}>
          <Text style={styles.openingSizeLabel}>Size of each</Text>

          <View style={styles.dimBox}>
            <TextInput
              style={styles.dimInput}
              placeholder="0"
              placeholderTextColor="#c4c4c4"
              keyboardType="decimal-pad"
              value={opening.w}
              onChangeText={(w) => onChange({ ...opening, w })}
            />
            <Text style={styles.dimUnit}>m</Text>
          </View>

          <Text style={styles.times}>×</Text>

          <View style={styles.dimBox}>
            <TextInput
              style={styles.dimInput}
              placeholder="0"
              placeholderTextColor="#c4c4c4"
              keyboardType="decimal-pad"
              value={opening.h}
              onChangeText={(h) => onChange({ ...opening, h })}
            />
            <Text style={styles.dimUnit}>m</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Counter({ label, hint, value, onChange }) {
  return (
    <View style={styles.counterRow}>
      <View style={styles.counterText}>
        <Text style={styles.counterLabel}>{label}</Text>
        <Text style={styles.counterHint}>{hint}</Text>
      </View>
      <View style={styles.counterCtl}>
        <TouchableOpacity
          style={styles.counterBtn}
          onPress={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
        >
          <Ionicons name="remove" size={18} color={value === 0 ? '#d4d4d4' : '#1a1a1a'} />
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(value + 1)}>
          <Ionicons name="add" size={18} color="#1a1a1a" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Line({ label, value }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

export default function PaintCalculator() {
  const params = useLocalSearchParams();
  const { token } = useAuthStore();

  const [product, setProduct]               = useState(null);
  const [loadingProduct, setLoadingProduct] = useState(Boolean(params.productId));
  const [adding, setAdding]                 = useState(false);

  // Wall 1 arrives prefilled when AR handed a measurement over on the way in.
  const [walls, setWalls] = useState(() => [{
    id: 1,
    w: params.width  ? String(params.width)  : '',
    h: params.height ? String(params.height) : '',
  }]);
  const nextWallId  = useRef(2);
  const measuringId = useRef(null);      // which wall asked for the camera

  // Each opening carries its own size, kept as strings like the wall rows so a
  // half-typed "2." is a string in progress rather than a NaN in the total.
  const [doors, setDoors]     = useState({ count: 0, ...DEFAULT_DOOR });
  const [windows, setWindows] = useState({ count: 0, ...DEFAULT_WINDOW });
  const [surface, setSurface] = useState(SURFACES[0].key);
  const [coats, setCoats]     = useState(2);

  const [resolved, setResolved] = useState(null);

  const isCustom = !!product?.is_custom_color;

  // The shade being priced arrives from the caller — the picker, the wall
  // preview, or the colour the customer chose on the product page. A product
  // now stocks many shades, so it has no single colour to fall back to.
  const chosenColor = product?.colors?.find((c) => c.key === params.colorKey) ?? null;
  const hex = params.hex || chosenColor?.hex_code || product?.colors?.[0]?.hex_code || null;

  const allVariants = product?.active_variants ?? [];

  // Only cans that can actually be bought may feed the plan, or the estimate
  // quotes cans the cart will refuse: for a custom product that means the base
  // this colour can go into ('' = the line makes no base distinction), and for
  // a ready-mixed one the sizes the CHOSEN SHADE comes in.
  const variants = isCustom
    ? allVariants.filter((v) => !v.base_code || v.base_code === resolved?.base_code)
    : params.colorKey
      ? allVariants.filter((v) => v.color_key === params.colorKey)
      : allVariants;

  useEffect(() => {
    if (!isCustom || !hex) return;
    let alive = true;
    fetch(`${API_URL}/colors/resolve?hex=${encodeURIComponent(hex)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setResolved(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isCustom, hex]);

  // Prices and stock are read fresh: the plan below quotes a total and adds it
  // to the cart, and a quote built on a stale price is one the cart will reject.
  useEffect(() => {
    if (!params.productId) return;
    let alive = true;
    fetch(`${API_URL}/products/${params.productId}`, { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive) setProduct(data); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingProduct(false); });
    return () => { alive = false; };
  }, [params.productId]);

  // Collect whatever the AR screen measured while we were off-screen.
  useFocusEffect(useCallback(() => {
    const measured = useMeasureStore.getState().take();
    const target = measuringId.current;
    measuringId.current = null;
    if (!measured || target == null) return;
    setWalls((prev) => prev.map((wall) => (
      wall.id === target
        ? { ...wall, w: measured.width.toFixed(2), h: measured.height.toFixed(2) }
        : wall
    )));
  }, []));

  const updateWall = useCallback((id, patch) => {
    setWalls((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  const addWall = useCallback(() => {
    setWalls((prev) => [...prev, { id: nextWallId.current++, w: '', h: '' }]);
  }, []);

  const deleteWall = useCallback((id) => {
    setWalls((prev) => (prev.length > 1 ? prev.filter((w) => w.id !== id) : prev));
  }, []);

  const measureWall = useCallback((id) => {
    measuringId.current = id;
    router.push({
      pathname: '/ar/preview',
      params: { from: 'estimator', ...(hex ? { hex } : {}) },
    });
  }, [hex]);

  const est = useMemo(() => {
    const wallArea = walls.reduce((sum, w) => sum + num(w.w) * num(w.h), 0);
    const openings = doors.count * num(doors.w) * num(doors.h)
                   + windows.count * num(windows.w) * num(windows.h);
    const net      = Math.max(0, wallArea - openings);
    const toCover  = net * coats;
    const rate     = (SURFACES.find((s) => s.key === surface) ?? SURFACES[0]).rate;
    return {
      wallArea,
      openings,
      net,
      toCover,
      rate,
      liters: toCover / rate,
      ready: wallArea > 0,
      overDeducted: wallArea > 0 && openings >= wallArea,
    };
  }, [walls, doors, windows, coats, surface]);

  const plan = useMemo(
    () => (est.ready && est.liters > 0 ? planPacks(est.liters, variants) : null),
    [est.ready, est.liters, variants],
  );

  const addPlanToCart = async () => {
    if (!plan?.lines.length) return;
    if (!token) {
      Alert.alert('Sign In Required', 'Sign in to add paint to your cart.');
      return;
    }

    setAdding(true);
    const failures = [];
    let added = 0;

    // Line by line, reporting each: stock moves between the estimate and the
    // tap, and "some of it went in" is the truth the customer needs.
    for (const line of plan.lines) {
      try {
        const res = await fetch(`${API_URL}/cart/add`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Accept':        'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            product_variant_id: line.variant.id,
            quantity:           line.count,
            // Without the colour this would quietly add untinted base paint.
            ...(isCustom && hex && { custom_hex: hex }),
          }),
        });
        const data = await res.json();
        if (res.ok) added += 1;
        else failures.push(`${line.count}× ${line.size}: ${data.message ?? 'unavailable'}`);
      } catch (e) {
        failures.push(`${line.count}× ${line.size}: ${e.message}`);
      }
    }

    setAdding(false);

    if (added === 0) {
      Alert.alert('Nothing Added', failures.join('\n\n') || 'These sizes are no longer available.');
      return;
    }

    Alert.alert(
      failures.length ? 'Partly Added to Cart' : 'Added to Cart',
      [
        `${added} of ${plan.lines.length} size${plan.lines.length === 1 ? '' : 's'} added.`,
        ...(failures.length ? ['', 'Could not add:', ...failures] : []),
      ].join('\n'),
      [
        { text: 'Keep Calculating', style: 'cancel' },
        { text: 'View Cart', onPress: () => router.push('/(tabs)/cart') },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Paint Calculator</Text>
        <Text style={styles.subtitle}>
          {product ? 'How much of this paint your walls need' : 'How much paint your walls need'}
        </Text>

        {product && (
          <View style={styles.productChip}>
            <View style={[styles.chipDot, { backgroundColor: hex || '#ccc' }]} />
            <View style={styles.chipText}>
              <Text style={styles.chipName} numberOfLines={1}>
                {product.name}{chosenColor ? ` — ${chosenColor.color_name || chosenColor.color_code}` : ''}
              </Text>
              <Text style={styles.chipMeta} numberOfLines={1}>
                {product.brand?.brand_name}
                {product.categories?.length ? `  ·  ${product.categories.map((c) => c.category_name).join(' · ')}` : ''}
              </Text>
            </View>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* 1 ── SURFACE AREA ──────────────────────────────── */}
        <Section step="1" title="Surface Area" hint="Measure each wall you plan to paint.">
          {walls.map((wall, i) => (
            <WallRow
              key={wall.id}
              index={i}
              wall={wall}
              canDelete={walls.length > 1}
              onChange={updateWall}
              onDelete={deleteWall}
              onMeasure={measureWall}
            />
          ))}

          <TouchableOpacity style={styles.addWallBtn} onPress={addWall}>
            <Ionicons name="add-circle" size={20} color="#b91c1c" />
            <Text style={styles.addWallText}>ADD WALL</Text>
          </TouchableOpacity>

          <Text style={styles.measureHint}>
            No tape measure? Tap the scan icon on a wall to measure it with the camera.
          </Text>

          {est.wallArea > 0 && (
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Total wall area</Text>
              <Text style={styles.subtotalValue}>{est.wallArea.toFixed(2)} m²</Text>
            </View>
          )}
        </Section>

        {/* 2 ── OPENINGS ──────────────────────────────────── */}
        <Section
          step="2"
          title="Doors &amp; Windows"
          hint="Counted at the usual sizes. Change them if yours are different — openings come straight off the paint you buy."
        >
          <OpeningRow label="Doors"   opening={doors}   onChange={setDoors} />
          <OpeningRow label="Windows" opening={windows} onChange={setWindows} />
        </Section>

        {/* 3 ── SURFACE ───────────────────────────────────── */}
        <Section
          step="3"
          title="Surface"
          hint="A thirsty surface drinks paint. This is the biggest thing between a job that finishes and one that runs out."
        >
          {SURFACES.map((s) => {
            const active = surface === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => setSurface(s.key)}
              >
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{s.label}</Text>
                  <Text style={styles.optionHint}>{s.hint}</Text>
                </View>
                <Text style={styles.optionRate}>{s.rate} m²/L</Text>
              </TouchableOpacity>
            );
          })}
        </Section>

        {/* 4 ── COATS ─────────────────────────────────────── */}
        <Section step="4" title="Coats" hint="Each coat is another full pass of paint.">
          <View style={styles.coatsRow}>
            {COATS.map((c) => {
              const active = coats === c.value;
              return (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.coatBtn, active && styles.coatBtnActive]}
                  onPress={() => setCoats(c.value)}
                >
                  <Text style={[styles.coatValue, active && styles.coatTextActive]}>
                    {c.value} coat{c.value === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.coatHint, active && styles.coatTextActive]}>{c.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        {/* ── RESULT — live, so there is no Calculate button to forget ── */}
        {!est.ready ? (
          <View style={styles.emptyResult}>
            <Ionicons name="calculator-outline" size={26} color="#c4c4c4" />
            <Text style={styles.emptyText}>
              Put in a wall width and height and the amount appears here.
            </Text>
          </View>
        ) : est.overDeducted ? (
          <View style={styles.emptyResult}>
            <Ionicons name="alert-circle-outline" size={26} color="#f97316" />
            <Text style={styles.emptyText}>
              The doors and windows add up to more than the wall itself. Check the counts and sizes above.
            </Text>
          </View>
        ) : (
          <View style={styles.resultCard}>
            <Text style={styles.resultLead}>You need about</Text>
            <Text style={styles.liters}>{est.liters.toFixed(1)} litres</Text>
            <Text style={styles.resultRate}>
              {est.net.toFixed(2)} m² × {coats} coat{coats === 1 ? '' : 's'}, at {est.rate} m² per litre
            </Text>

            <View style={styles.divider} />

            <Line label="Wall area" value={`${est.wallArea.toFixed(2)} m²`} />
            {est.openings > 0 && (
              <Line label="Less doors & windows" value={`− ${est.openings.toFixed(2)} m²`} />
            )}
            <Line label="Area to paint" value={`${est.net.toFixed(2)} m²`} />
            <Line
              label={`Surface to cover (${coats} coat${coats === 1 ? '' : 's'})`}
              value={`${est.toCover.toFixed(2)} m²`}
            />

            {plan && plan.lines.length > 0 ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.planTitle}>Cheapest way to buy it</Text>

                {plan.lines.map((line) => (
                  <View key={line.variant.id} style={styles.planLine}>
                    <View style={styles.planQty}>
                      <Text style={styles.planQtyText}>{line.count}×</Text>
                    </View>
                    <Text style={styles.planSize}>{line.size}</Text>
                    <Text style={styles.planCost}>{peso(line.cost)}</Text>
                  </View>
                ))}

                <View style={styles.planTotal}>
                  <Text style={styles.planTotalLabel}>{plan.liters.toFixed(1)} L in total</Text>
                  <Text style={styles.planTotalValue}>{peso(plan.cost)}</Text>
                </View>

                {plan.short > 0.001 && (
                  <Text style={styles.shortNote}>
                    {/* For a custom mix the constraint is the BASE on the shelf,
                        not the colour — the colour is made on the spot. */}
                    Only {plan.liters.toFixed(1)} L of {isCustom ? 'this paint' : 'this colour'}
                    {' '}is in stock right now — {plan.short.toFixed(1)} L short of the job.
                  </Text>
                )}

                <TouchableOpacity style={styles.primaryBtn} onPress={addPlanToCart} disabled={adding}>
                  {adding
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <>
                        <Ionicons name="cart-outline" size={18} color="#fff" />
                        <Text style={styles.primaryBtnText}>Add These to Cart</Text>
                      </>
                    )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.divider} />
                <Text style={styles.planEmpty}>
                  {loadingProduct
                    ? 'Checking sizes and prices…'
                    : product
                      ? 'None of this paint’s sizes are in stock right now.'
                      : 'Pick a paint and this turns into cans and a price.'}
                </Text>
                {!product && !loadingProduct && (
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/(tabs)')}>
                    <Ionicons name="color-palette-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnText}>Browse Paints</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        <Text style={styles.footNote}>
          An estimate. Spread rates move with how the paint goes on, so buy a little
          over rather than a little under — a second trip costs more than a spare litre.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f5f5f5' },

  header:           { backgroundColor: '#b91c1c', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  backBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backText:         { color: 'rgba(255,255,255,0.9)', fontSize: 15 },
  title:            { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle:         { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  productChip:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.16)', borderRadius: 12, padding: 10, marginTop: 16 },
  chipDot:          { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  chipText:         { flex: 1 },
  chipName:         { color: '#fff', fontSize: 14, fontWeight: '600' },
  chipMeta:         { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },

  content:          { padding: 16, paddingBottom: 40 },

  card:             { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  sectionHead:      { flexDirection: 'row', gap: 12, marginBottom: 16 },
  stepDot:          { width: 26, height: 26, borderRadius: 13, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center' },
  stepNum:          { color: '#fff', fontSize: 13, fontWeight: '700' },
  sectionHeadText:  { flex: 1 },
  sectionTitle:     { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  sectionHint:      { fontSize: 12, color: '#999', marginTop: 3, lineHeight: 17 },

  // Walls
  wallRow:          { marginBottom: 14 },
  wallLabel:        { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 6 },
  wallInputs:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dimBox:           { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 12 },
  dimInput:         { flex: 1, paddingVertical: 11, fontSize: 15, color: '#1a1a1a' },
  dimUnit:          { fontSize: 13, color: '#999' },
  times:            { fontSize: 14, color: '#999' },
  iconBtn:          { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  wallArea:         { fontSize: 12, color: '#b91c1c', fontWeight: '600', marginTop: 5 },

  addWallBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  addWallText:      { color: '#b91c1c', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
  measureHint:      { fontSize: 11.5, color: '#999', lineHeight: 17, marginTop: 2 },

  subtotal:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', marginTop: 12, paddingTop: 12 },
  subtotalLabel:    { fontSize: 13, color: '#666' },
  subtotalValue:    { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },

  // Counters
  counterRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  counterText:      { flex: 1 },
  counterLabel:     { fontSize: 14, color: '#1a1a1a', fontWeight: '600' },
  counterHint:      { fontSize: 12, color: '#999', marginTop: 2 },
  counterCtl:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 4 },
  counterBtn:       { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  counterValue:     { minWidth: 26, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#1a1a1a' },

  // Per-opening size, indented under its counter so it reads as belonging to it
  openingSize:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 2, paddingBottom: 12, marginTop: -4, flexWrap: 'wrap' },
  openingSizeLabel: { fontSize: 12, color: '#999', marginRight: 2 },

  // Surface options
  option:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#f0f0f0', marginBottom: 8 },
  optionActive:     { borderColor: '#b91c1c', backgroundColor: '#fef2f2' },
  radio:            { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d4d4d4', alignItems: 'center', justifyContent: 'center' },
  radioActive:      { borderColor: '#b91c1c' },
  radioDot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: '#b91c1c' },
  optionText:       { flex: 1 },
  optionLabel:      { fontSize: 14, color: '#1a1a1a', fontWeight: '600' },
  optionLabelActive:{ color: '#b91c1c' },
  optionHint:       { fontSize: 11.5, color: '#999', marginTop: 2 },
  optionRate:       { fontSize: 11.5, color: '#999', fontWeight: '600' },

  // Coats
  coatsRow:         { flexDirection: 'row', gap: 8 },
  coatBtn:          { flex: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', backgroundColor: '#f5f5f5' },
  coatBtnActive:    { backgroundColor: '#b91c1c' },
  coatValue:        { fontWeight: '700', color: '#1a1a1a', fontSize: 14 },
  coatHint:         { fontSize: 10.5, color: '#999', marginTop: 3, textAlign: 'center' },
  coatTextActive:   { color: '#fff' },

  // Result
  emptyResult:      { alignItems: 'center', gap: 10, padding: 24, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#e0e0e0' },
  emptyText:        { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 19 },

  resultCard:       { backgroundColor: '#fff', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  resultLead:       { fontSize: 13, color: '#666' },
  liters:           { fontSize: 38, fontWeight: '700', color: '#b91c1c', marginTop: 2 },
  resultRate:       { fontSize: 12, color: '#999', marginTop: 2 },
  divider:          { height: 1, backgroundColor: '#f0f0f0', marginVertical: 16 },

  line:             { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  lineLabel:        { fontSize: 13.5, color: '#666' },
  lineValue:        { fontSize: 13.5, color: '#1a1a1a', fontWeight: '600' },

  planTitle:        { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  planLine:         { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  planQty:          { minWidth: 40, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#fef2f2', alignItems: 'center' },
  planQtyText:      { color: '#b91c1c', fontWeight: '700', fontSize: 14 },
  planSize:         { flex: 1, fontSize: 14, color: '#1a1a1a', fontWeight: '600' },
  planCost:         { fontSize: 14, color: '#666' },
  planTotal:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12, marginTop: 4, marginBottom: 16 },
  planTotalLabel:   { fontSize: 13.5, color: '#666' },
  planTotalValue:   { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  planEmpty:        { fontSize: 13, color: '#999', lineHeight: 19, marginBottom: 16 },
  shortNote:        { fontSize: 12, color: '#f97316', lineHeight: 18, marginBottom: 14 },

  primaryBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16 },
  primaryBtnText:   { color: '#fff', fontSize: 15.5, fontWeight: '700' },

  footNote:         { fontSize: 11.5, color: '#999', lineHeight: 17, textAlign: 'center', marginTop: 18, paddingHorizontal: 8 },
});
