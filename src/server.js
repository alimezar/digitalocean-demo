const http = require('http');

const message = process.env.ENV_MESSAGE || "No environment message set!";

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});;sds
  res.end(message);a
});

server.listen(3000, () => {
  console.log("Server running on port 3000"); //comment
});