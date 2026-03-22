/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.svg' {
  import * as React from 'react';
  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}
