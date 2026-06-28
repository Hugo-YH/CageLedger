/// <reference types="vite/client" />

declare global {
  interface Window {
    jsQR?: (...args: unknown[]) => { data?: string } | null;
  }
}

export {};
