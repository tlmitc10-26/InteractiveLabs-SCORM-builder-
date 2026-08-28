/**
 * Re-export shim: the canonical implementation moved to
 * src/lib/engines/slugify.ts so light lib modules (e.g. companion-doc.ts)
 * can depend on it without a lib->app import direction. Kept here so
 * existing `@/app/interactives/[id]/slugify` imports keep working.
 */
export { slugify, uniqueSlug } from "@/lib/engines/slugify";
