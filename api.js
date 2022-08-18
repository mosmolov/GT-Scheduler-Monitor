const express = require('express');
const app = express();
const mainPort = 80;
const tlsPort = 443;

app.use(express.json());
app.use(express.urlencoded());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


app.listen(mainPort, () => {
  console.log(`App listening on port ${mainPort}`)
});

app.listen(tlsPort, () => {
    console.log(`App listening on port ${tlsPort}`)
});
module.exports = app;