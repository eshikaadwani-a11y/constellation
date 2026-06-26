/**
 * Ambient declarations for the browser libraries Constellation loads at runtime
 * through an ESM import map (see `public/app.html`).
 *
 * Why this file exists: the build sandbox is network-isolated and cannot reach
 * any package registry, so the real `@types/*` packages can't be installed.
 * Rather than block on that, we declare the precise slice of each library's
 * surface that the UI actually uses. Each milestone extends this file as it
 * adopts more of a library. When package access is available, this file is
 * deleted and replaced by the upstream type packages with no code changes.
 */

declare module "react" {
  export type Key = string | number;
  export type ReactNode = ReactElement | string | number | boolean | null | undefined | ReactNode[];
  export interface ReactElement {
    type: unknown;
    props: unknown;
    key: Key | null;
  }
  export type ComponentType<P = Record<string, unknown>> = (props: P) => ReactElement | null;
  export type FC<P = Record<string, unknown>> = ComponentType<P>;
  export type FunctionComponent<P = Record<string, unknown>> = ComponentType<P>;

  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type RefObject<T> = { current: T };

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[],
  ): void;
  export function useRef<T>(initial: T): RefObject<T>;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(
    cb: T,
    deps: readonly unknown[],
  ): T;
  export function useContext<T>(ctx: Context<T>): T;
  export interface Context<T> {
    Provider: ComponentType<{ value: T; children?: ReactNode }>;
    Consumer: ComponentType<{ children: (value: T) => ReactNode }>;
  }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function createElement(
    type: unknown,
    props?: unknown,
    ...children: unknown[]
  ): ReactElement;
  export const Fragment: unique symbol;
  export function memo<T>(component: T): T;

  const React: {
    createElement: typeof createElement;
    Fragment: typeof Fragment;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  import type { ReactElement } from "react";
  export const Fragment: unique symbol;
  export function jsx(type: unknown, props: unknown, key?: unknown): ReactElement;
  export function jsxs(type: unknown, props: unknown, key?: unknown): ReactElement;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

// JSX intrinsic elements are typed loosely: we can't ship the full DOM prop
// surface without @types/react, but our own components remain fully checked.
// Declared at top level (this file is an ambient script) so it lands in the
// global scope where the react-jsx runtime looks it up.
declare namespace JSX {
  type Element = import("react").ReactElement;
  interface ElementChildrenAttribute {
    children: Record<string, never>;
  }
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
