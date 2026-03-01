// @refresh reload
import { StartServer, createHandler } from "@solidjs/start/server";

const faviconHref =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f172a'/%3E%3Ctext x='32' y='41' text-anchor='middle' font-size='30' fill='white'%3Eq%3C/text%3E%3C/svg%3E";

export default createHandler(() => (
  <StartServer
    document={(args) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>quietr</title>
          <link rel="icon" type="image/svg+xml" href={faviconHref} />
          {args.assets}
        </head>
        <body>
          <div id="app">{args.children}</div>
          {args.scripts}
        </body>
      </html>
    )}
  />
));
