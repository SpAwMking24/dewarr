declare module "foliate-js/view.js" {
  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[];
  }

  export interface FoliateRelocateDetail {
    fraction: number;
    cfi?: string;
    tocItem?: { label?: string; href?: string };
    location?: { current?: number; next?: number; total?: number };
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles?: (css: string) => void;
    next?: () => Promise<void>;
    prev?: () => Promise<void>;
  }

  export interface FoliateViewElement extends HTMLElement {
    book?: {
      toc?: FoliateTocItem[];
      metadata?: { title?: string };
      dir?: string;
    };
    renderer: FoliateRenderer;
    open: (target: File | Blob | string) => Promise<void>;
    init: (options: {
      lastLocation?: string;
      showTextStart?: boolean;
    }) => Promise<void>;
    goTo: (target: string | number) => Promise<unknown>;
    goToFraction: (fraction: number) => Promise<void>;
    next: (distance?: number) => Promise<void>;
    prev: (distance?: number) => Promise<void>;
    goLeft: () => Promise<void>;
    goRight: () => Promise<void>;
    close: () => void;
  }

  export class View extends HTMLElement {}
}
