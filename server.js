const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autism: Bringing Change</title>
  </head>
  <body style="font-family: system-ui; background: #faf6ee; color: #26324f; padding: 3rem;">
    <h1>Autism: Bringing Change</h1>
    <p>Building blocks for a better future. Site v2 under construction.</p>
  </body>
</html>`);
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));