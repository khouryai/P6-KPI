import { useEffect, useState } from 'react';

export type Route = { screen: string; params: URLSearchParams };

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [screen, query = ''] = h.split('?');
  return { screen: screen || 'dashboard', params: new URLSearchParams(query) };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function href(screen: string, params?: Record<string, string>): string {
  const q = params ? new URLSearchParams(params).toString() : '';
  return `#/${screen}${q ? `?${q}` : ''}`;
}

export function navigate(screen: string, params?: Record<string, string>): void {
  window.location.hash = href(screen, params);
}
