# Next.js and React performance

Framework-specific causes behind the metrics. Applies to the App Router
(Next.js 13–16) unless noted; Pages Router equivalents are called out.

## The client boundary is the bundle

Every `'use client'` module **and everything it imports** ships to the browser and
gets hydrated. Marking a container client-side pulls its whole subtree with it.
This is the single biggest structural cause of large route bundles.

```jsx
// ✗ the whole page becomes client code because one button needs state
'use client';
export default function ProductPage({ product }) {
  const [qty, setQty] = useState(1);
  return <><ProductDetails product={product} /><button onClick={…}>Add</button></>;
}

// ✓ only the interactive leaf is client code
export default function ProductPage({ product }) {      // server component
  return <><ProductDetails product={product} /><AddToCart id={product.id} /></>;
}
```

When a client component must wrap server-rendered content, pass it as `children`
rather than importing it — children rendered on the server stay on the server.

Audit questions:

- What fraction of components are `'use client'`? Above ~40% something is wrong.
- Is any `'use client'` at a layout or page level? Push it down.
- Does a client component import a heavy library used only for display?

## Data fetching

| Pattern | Cost |
|---|---|
| `useEffect` + `fetch` | HTML → JS download → hydrate → fetch → render. The content cannot exist in the first paint, and it is absent from the server-rendered HTML crawlers read. |
| Server component `await` | Data is in the first response. |
| Sequential `await`s | Each one adds a round trip; use `Promise.all` when they are independent. |
| Fetch in a client component after hydration | Guarantees an LCP that starts late. |

Deduplicate with `React.cache()` (per render pass) and Next's fetch memoization.
Two components fetching the same endpoint should produce one request.

## Bundle work

```bash
ANALYZE=true next build                       # with @next/bundle-analyzer
npx source-map-explorer '.next/static/chunks/*.js'
```

Then:

- `next/dynamic` for anything below the fold or behind an interaction — charts, editors, maps, modals. `{ ssr: false }` only when the component genuinely cannot render on the server.
- `experimental.optimizePackageImports` for barrel packages (`lodash-es`, `date-fns`, icon sets).
- Import individual symbols, never the barrel: `import debounce from 'lodash-es/debounce'`.
- Check `browserslist` — targeting dead browsers ships polyfills to everyone.

## Re-renders and INP

Common causes, in the order they usually show up in a trace:

1. **New object/array/function identity as a prop** on every render → memoized children re-render anyway. `useMemo` / `useCallback` at the boundary that matters.
2. **A context whose value is a new object each render** → every consumer re-renders. Split contexts by update frequency; memoize the value.
3. **State held too high** → a keystroke in a form re-renders the page. Move state to the component that owns it.
4. **Unvirtualized long lists** → every item re-renders and the DOM is enormous.
5. **Expensive work inside the handler** → move it off the interaction, chunk it, or offload to a worker.

React 19's compiler removes much of the manual memoization, but not the structural
problems (2), (3) and (4).

## Images

`next/image` handles most of it, if used correctly:

```jsx
<Image src={hero} alt="…" priority width={1200} height={630}
       sizes="(max-width: 768px) 100vw, 1200px" />
```

- `priority` on the LCP image only — it preloads and sets `fetchpriority="high"`.
- `sizes` is required whenever the rendered width is not the intrinsic width; without it the browser downloads the largest candidate.
- `fill` requires a positioned parent with real dimensions, or it becomes a CLS source.
- Never `loading="lazy"` on the LCP element.

## Fonts

`next/font` self-hosts, subsets and inlines the `@font-face` at build time, which
removes a connection setup and a request-chain level versus Google Fonts CDN.
Prefer one variable font per family, `display: 'swap'`, and a fallback with
adjusted metrics (`size-adjust`, `ascent-override`) to avoid the swap shifting layout.

## Third-party scripts

```jsx
import Script from 'next/script';
<Script src="…" strategy="afterInteractive" />   // default: after hydration
<Script src="…" strategy="lazyOnload" />         // idle — analytics, chat, pixels
<Script src="…" strategy="beforeInteractive" />  // rare; blocks — consent managers only
```

Heavy embeds (video, chat, maps) belong behind a facade: render a placeholder,
load the real widget on first interaction.

## Caching and rendering modes

- Static generation where the content allows; ISR/revalidation where it changes.
- `'use cache'` and `dynamicIO` (Next.js 15+) to scope caching precisely instead of forcing a whole route dynamic.
- Partial Prerendering: static shell streams immediately, dynamic holes stream in — good for LCP when part of the page is personalized.
- `after()` for work that must happen but must not block the response (logging, analytics, cache warming).
- One uncached `cookies()` / `headers()` read opts the whole route into dynamic rendering. Check before blaming TTFB on the database.

## Runtime

- `<Link prefetch>` warms the destination chunk and data on viewport/hover — the main lever on slow route transitions.
- Render a meaningful `loading.tsx` boundary so a transition shows progress instead of freezing.
- Clean up listeners, timers and subscriptions in effect teardown; App Router keeps the app alive across navigations, so leaks accumulate over a session.
