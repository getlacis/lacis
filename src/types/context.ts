// Probably will not be used, depends on how I want it minimalist

export interface RouteContext {
    // Les bases
    req: {
      url: string;
      method: string;
      headers: Record<string, string | string[] | undefined>;
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: any;
    };
    
    res: {
      status: (code: number) => void;
      send: (data: any) => void;
      json: (data: any) => void;
      headers: Record<string, string | string[]>;
      redirect: (url: string) => void;
      /*render?: (view: string, data: any) => void; fuck SSR, all my homies hate to implement SSR (I'm the only one to do this shit ngl). More seriously, maybe later but idk */
    };
  
    // Utilitaires
    utils: {
      parseBody: () => Promise<any>;
      getCookie: (name: string) => string | undefined;
      setCookie: (name: string, value: string, options?: CookieOptions) => void;
    };
  
    // Info sur l'environnement
    env: {
      isDev: boolean;
      platform: 'node' | 'vercel' | 'netlify';
    };
  }

  interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }