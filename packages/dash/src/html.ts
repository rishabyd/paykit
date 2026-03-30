export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PayKit Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 500;
      letter-spacing: -0.025em;
    }
    p {
      color: #666;
      margin-top: 0.5rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>PayKit Dashboard</h1>
    <p>Authorized</p>
  </div>
</body>
</html>`;
}

export function getUnauthorizedHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PayKit Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 500;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>Unauthorized</h1>
</body>
</html>`;
}
