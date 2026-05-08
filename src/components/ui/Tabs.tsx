import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Thin shadcn-style wrapper around Radix Tabs. We expose the four
 * primitive parts (`Root`, `List`, `Trigger`, `Content`) so the call
 * site keeps full control of `value` / `onValueChange` — this matters
 * for the Library page, which derives the active tab from the URL
 * query string and can't pass it through Radix's uncontrolled state.
 *
 * The visual recipe is intentionally compact: a horizontal pill row
 * that scrolls on narrow viewports (mirroring the existing chip
 * implementation that the codebase already used). The active state
 * uses a motion-friendly background swap; the indicator slide lives
 * on the consumer if they want one (the Library page renders a
 * `motion.div` underline via Radix's `data-state="active"` attribute).
 */

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        '-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        // Base pill — neutral on inactive
        'group relative shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
        // Active state — solid foreground on background reverse
        'data-[state=active]:bg-foreground data-[state=active]:text-background',
        // Focus ring
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
});
