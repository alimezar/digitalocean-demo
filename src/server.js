// src/server.js
const http = require("http");

const message = process.env.ENV_MESSAGE || "No environment message set!";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(message);
});

// Only listen if this file is run directly: `node src/server.js`
if (require.main === module) {
  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

// Export the server so tests can require it
module.exports = server;
