'use client';

/**
 * Density context — lets a subtree opt into the `compact` register once (e.g. a
 * dense data console or a packed toolbar) and have every kit primitive inside
 * inherit it, while any single component can still override locally via its own
 * `density` prop.
 *
 * Resolution order (see `useDensity`): explicit prop > surrounding provider >
 * 'comfortable' default. This keeps the whole kit on ONE density scale
 * (see `densityPadding` in ui-system.ts) without threading props everywhere.
 */
import * as React from 'react';
import type { Density } from './ui-system';

/** Ambient density for a subtree. Defaults to the calm 'comfortable' register. */
export const DensityContext = React.createContext<Density>('comfortable');
DensityContext.displayName = 'DensityContext';

export interface DensityProviderProps {
  /** Density applied to every kit primitive in this subtree. */
  density: Density;
  children: React.ReactNode;
}

/** Provide an ambient density to all descendant kit primitives. */
export function DensityProvider({ density, children }: DensityProviderProps) {
  return (
    <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
  );
}

/**
 * Resolve the effective density for a primitive.
 *
 * @param override - a component-local `density` prop; wins when provided.
 * @returns override ?? ambient provider value ?? 'comfortable'.
 */
export function useDensity(override?: Density): Density {
  const ambient = React.useContext(DensityContext);
  return override ?? ambient ?? 'comfortable';
}
