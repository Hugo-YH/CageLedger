/// <reference types="vite/client" />
import type jsQR from "./vendor/jsQR";

declare global {
  interface Window {
    jsQR?: typeof jsQR;
  }
}

export {};
