// src/server.js
const http = require("http");

const message = process.env.ENV_MESSAGE || "No environment message set!";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(message);
});
// Sucessfully stops build due to compile error -> skfjew
if (require.main === module) {
  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

// Export the server so tests can require it
module.exports = server;
