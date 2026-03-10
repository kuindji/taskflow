type RouteHandler = (req: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class ApiRouter {
  private routes: Route[] = [];

  register(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      return route.handler(req, params);
    }

    return null;
  }
}
