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
  export function useRef<T>(initial: T | null): RefObject<T | null>;
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

// --- React Flow (https://reactflow.dev) -----------------------------------
// Typed loosely: the graph data we pass in is fully checked by our own model
// types; React Flow's internal prop surface is treated as opaque.
declare module "reactflow" {
  import type { ComponentType, ReactNode } from "react";
  export interface XYPosition {
    x: number;
    y: number;
  }
  export interface Node<T = unknown> {
    id: string;
    position: XYPosition;
    data: T;
    type?: string;
    selected?: boolean;
    draggable?: boolean;
    [key: string]: unknown;
  }
  export interface Edge<T = unknown> {
    id: string;
    source: string;
    target: string;
    type?: string;
    animated?: boolean;
    label?: string;
    data?: T;
    [key: string]: unknown;
  }
  export interface NodeProps<T = unknown> {
    id: string;
    data: T;
    selected: boolean;
    [key: string]: unknown;
  }
  export type NodeTypes = Record<string, ComponentType<NodeProps>>;
  export type EdgeTypes = Record<string, ComponentType<unknown>>;
  export type OnNodesChange = (changes: unknown[]) => void;
  export type OnEdgesChange = (changes: unknown[]) => void;

  export const Background: ComponentType<Record<string, unknown>>;
  export const Controls: ComponentType<Record<string, unknown>>;
  export const MiniMap: ComponentType<Record<string, unknown>>;
  export const Handle: ComponentType<Record<string, unknown>>;
  export const Position: { Left: "left"; Top: "top"; Right: "right"; Bottom: "bottom" };
  export const BackgroundVariant: { Dots: "dots"; Lines: "lines"; Cross: "cross" };
  export const MarkerType: { Arrow: "arrow"; ArrowClosed: "arrowclosed" };
  export const ReactFlowProvider: ComponentType<{ children?: ReactNode }>;

  export function useNodesState(
    initial: Node[],
  ): [Node[], (updater: Node[] | ((prev: Node[]) => Node[])) => void, OnNodesChange];
  export function useEdgesState(
    initial: Edge[],
  ): [Edge[], (updater: Edge[] | ((prev: Edge[]) => Edge[])) => void, OnEdgesChange];

  const ReactFlow: ComponentType<Record<string, unknown>>;
  export default ReactFlow;
}

// --- Framer Motion --------------------------------------------------------
declare module "framer-motion" {
  import type { ComponentType, ReactNode } from "react";
  // `motion.<tag>` is an open proxy of animated components; typed as `any` at
  // this third-party boundary (our own component props remain fully checked).
  export const motion: any;
  export const AnimatePresence: ComponentType<{ children?: ReactNode; initial?: boolean }>;
}

// --- ECharts --------------------------------------------------------------
declare module "echarts" {
  export interface EChartsInstance {
    setOption(option: unknown, notMerge?: boolean): void;
    resize(): void;
    dispose(): void;
  }
  export function init(
    dom: HTMLElement,
    theme?: string | null,
    opts?: Record<string, unknown>,
  ): EChartsInstance;
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
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
