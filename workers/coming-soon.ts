const page = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Search Auditor | Coming Soon</title>
    <meta
      name="description"
      content="AI Search Auditor is coming soon. Track how your brand appears across AI search and answer engines."
    />
    <style>
      :root {
        color-scheme: light;
        --ink: #16130f;
        --muted: #6e6257;
        --cream: #f6efe2;
        --paper: #fffaf0;
        --ember: #df6f33;
        --moss: #556b45;
        --line: rgba(22, 19, 15, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 15% 15%, rgba(223, 111, 51, 0.22), transparent 30rem),
          radial-gradient(circle at 85% 80%, rgba(85, 107, 69, 0.22), transparent 28rem),
          linear-gradient(135deg, var(--cream), var(--paper));
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 56px 56px;
        mask-image: radial-gradient(circle at center, black, transparent 72%);
      }

      main {
        width: min(920px, calc(100vw - 32px));
        padding: clamp(32px, 7vw, 84px);
        position: relative;
        border: 1px solid var(--line);
        border-radius: 34px;
        background: rgba(255, 250, 240, 0.76);
        box-shadow: 0 32px 90px rgba(68, 47, 25, 0.18);
        backdrop-filter: blur(18px);
      }

      .eyebrow {
        margin: 0 0 24px;
        font: 700 0.78rem/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--moss);
      }

      h1 {
        max-width: 780px;
        margin: 0;
        font-size: clamp(3.3rem, 11vw, 8.5rem);
        line-height: 0.88;
        letter-spacing: -0.08em;
      }

      p {
        max-width: 620px;
        margin: 28px 0 0;
        color: var(--muted);
        font: 1.15rem/1.7 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-top: 40px;
        padding: 12px 16px;
        border: 1px solid rgba(223, 111, 51, 0.28);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.46);
        color: var(--ember);
        font: 700 0.82rem/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .badge::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 22px currentColor;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">AI Search Auditor</p>
      <h1>Coming soon.</h1>
      <p>
        We are building a sharper way to see how your business appears across AI search,
        answer engines, and the websites shaping those recommendations.
      </p>
      <div class="badge">Dashboard in private launch</div>
    </main>
  </body>
</html>`;

export default {
  fetch(request: Request) {
    const url = new URL(request.url);

    if (url.hostname === "www.aisearchauditor.com") {
      url.hostname = "aisearchauditor.com";
      return Response.redirect(url.toString(), 301);
    }

    return new Response(page, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300"
      }
    });
  }
};
