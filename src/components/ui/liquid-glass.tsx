import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { LiquidGlass, type GlassConfig } from '@ybouane/liquidglass';
import { cn } from '@/lib/utils';

/**
 * Thin React wrapper around the imperative `@ybouane/liquidglass`
 * WebGL pipeline.
 *
 * Architectural constraints from the upstream library that shape this
 * wrapper's API:
 *
 *   1. The library mounts a single WebGL canvas onto the `root` and
 *      composites every glass child against a software-rasterised copy
 *      of the root's local scene. Glass elements MUST be direct (or
 *      near-direct) descendants of the same root — they cannot live
 *      inside a React portal because the rasteriser only walks the
 *      root subtree.
 *   2. Glass elements should be marked with the data attribute below
 *      so we can hand them to `init()` without a brittle CSS-class
 *      query. We auto-generate a per-instance scope id and select
 *      `[data-liquidglass-panel="<id>"]` so two `<LiquidGlassRoot>`s
 *      can coexist on the same page.
 *   3. The library reads the root's bounding rect synchronously
 *      during `init()`. We defer to a layout effect so the root is
 *      laid out before init runs — without this the very first frame
 *      sees zero-sized glass canvases and the user gets a flash of
 *      empty rectangles before the first resize.
 *   4. Some environments can't run the effect:
 *        - SSR (no `document` / `window`)
 *        - WebGL disabled (some Linux + GPU-accel-off, or kiosk
 *          builds with `--use-gl=disabled`)
 *        - `prefers-reduced-motion: reduce` users — the library runs
 *          a 60 fps capture+composite loop that's exactly the kind
 *          of motion the OS-level preference is meant to suppress.
 *      In all of those we silently fall back to a CSS-only treatment
 *      that mimics the visual look so the layout doesn't shift and
 *      consumers don't have to write feature-gate logic.
 */

interface LiquidGlassRootProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional override for the upstream `GlassConfig` defaults. */
  config?: Partial<GlassConfig>;
  /**
   * When `false` the WebGL pipeline never initialises and only the
   * CSS fallback paints. Use this for places where we know WebGL is
   * unsuitable (long lists, mounted-during-scroll content, etc.).
   * Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * Wraps every direct child in `position: relative` so the glass
   * panels can place their absolute canvas overlays without leaking
   * out of their parent box. Defaults to `true`.
   */
  isolatePanels?: boolean;
  children?: ReactNode;
}

export interface LiquidGlassHandle {
  /**
   * Expose `markChanged()` so consumers can pulse the renderer when
   * something they animated outside React's tree (e.g. a cover image
   * crossfade) needs to trigger a fresh capture.
   */
  markChanged: (element?: HTMLElement) => void;
  /** The active library instance, or null when running in CSS fallback. */
  instance: LiquidGlass | null;
}

/**
 * Detect whether the current environment can run the WebGL liquid
 * glass effect. Cached at module scope because the result never
 * changes during a session.
 */
let _webglSupportCache: boolean | null = null;
function detectWebGLSupport(): boolean {
  if (_webglSupportCache !== null) return _webglSupportCache;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    _webglSupportCache = ctx !== null;
    return _webglSupportCache;
  } catch {
    _webglSupportCache = false;
    return false;
  }
}

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const LiquidGlassRoot = forwardRef<LiquidGlassHandle, LiquidGlassRootProps>(
  function LiquidGlassRoot(
    {
      children,
      className,
      config,
      enabled = true,
      isolatePanels: _isolatePanels = true,
      ...rest
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const instanceRef = useRef<LiquidGlass | null>(null);
    const [active, setActive] = useState(false);
    const scopeId = useId();
    // useId returns a string with `:` — invalid for a CSS attribute
    // selector without escaping, so strip the colons up-front.
    const scopeKey = useMemo(() => scopeId.replace(/:/g, ''), [scopeId]);

    useImperativeHandle(
      ref,
      () => ({
        markChanged: (element) => instanceRef.current?.markChanged(element),
        get instance() {
          return instanceRef.current;
        },
      }),
      [],
    );

    // useLayoutEffect so the root has its real bounding box before
    // the library captures the initial scene. The library still kicks
    // off async work internally, but the synchronous part needs the
    // box to be non-zero.
    useLayoutEffect(() => {
      if (!enabled) return;
      if (typeof window === 'undefined') return;
      if (detectReducedMotion()) return;
      if (!detectWebGLSupport()) return;

      const root = rootRef.current;
      if (!root) return;

      const panels = root.querySelectorAll<HTMLElement>(
        `[data-liquidglass-panel="${scopeKey}"]`,
      );
      if (panels.length === 0) return;

      let cancelled = false;

      LiquidGlass.init({
        root,
        glassElements: panels,
        defaults: config,
      })
        .then((inst) => {
          if (cancelled) {
            inst.destroy();
            return;
          }
          instanceRef.current = inst;
          setActive(true);
        })
        .catch((err) => {
          // The library throws on WebGL context loss / unsupported
          // shader path / bogus root. We swallow the error so the
          // app continues to paint via the CSS fallback — surfacing
          // it would only spam the console in environments we
          // already gated against.
          if (import.meta.env?.DEV) {
            console.warn('[LiquidGlassRoot] init failed, falling back to CSS:', err);
          }
        });

      return () => {
        cancelled = true;
        instanceRef.current?.destroy();
        instanceRef.current = null;
        setActive(false);
      };
      // We intentionally re-init when `enabled` flips or `scopeKey`
      // changes (panel set rebuilt). We don't want to re-init on
      // every config change — pass a stable reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, scopeKey]);

    return (
      <div
        ref={rootRef}
        data-liquidglass-root={scopeKey}
        data-liquidglass-active={active ? 'true' : 'false'}
        className={cn('relative isolate', className)}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

interface LiquidGlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Marks the panel content as visually dynamic so the upstream
   * library re-captures it every frame. Use sparingly — every
   * dynamic panel pays a per-frame DOM-to-image cost.
   */
  dynamic?: boolean;
  /**
   * Visual preset that maps to a CSS recipe. The CSS layer is
   * always painted — both as the "off" state on devices without
   * WebGL and as the lighting/border bezel under the WebGL
   * refraction on devices that have it.
   */
  variant?: 'default' | 'soft' | 'aggressive';
  children?: ReactNode;
}

const variantClasses: Record<NonNullable<LiquidGlassPanelProps['variant']>, string> = {
  default: 'liquid-glass',
  soft: 'liquid-glass liquid-glass--soft',
  aggressive: 'liquid-glass liquid-glass--aggressive',
};

/**
 * Declarative glass panel. Must live inside a `<LiquidGlassRoot>` —
 * outside of one the WebGL effect won't engage but the CSS recipe
 * still paints, which is the same look the rest of the codebase
 * already gets from the bare `.liquid-glass` class.
 */
export function LiquidGlassPanel({
  className,
  variant = 'default',
  dynamic = false,
  style,
  children,
  ...rest
}: LiquidGlassPanelProps) {
  // Inherit the parent root's scope id so we hand the right panels
  // to `init()`. We read it on mount via a ref-callback rather than
  // a context to keep the API portable for future use without the
  // root (the panel still works as a plain CSS shell).
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const setRef = (node: HTMLDivElement | null) => {
    if (!node) return;
    const root = node.closest<HTMLElement>('[data-liquidglass-root]');
    const id = root?.dataset.liquidglassRoot ?? null;
    setScopeKey(id);
  };

  const composedStyle: CSSProperties = useMemo(
    () => ({ position: 'relative', ...style }),
    [style],
  );

  return (
    <div
      ref={setRef}
      data-liquidglass-panel={scopeKey ?? undefined}
      data-dynamic={dynamic ? '' : undefined}
      style={composedStyle}
      className={cn(variantClasses[variant], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
