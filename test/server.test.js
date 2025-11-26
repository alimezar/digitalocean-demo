// test/server.test.js
const http = require("http");
const assert = require("assert");
const server = require("../src/server");

const PORT = 4000;

server.listen(PORT, () => {
  const options = {
    hostname: "127.0.0.1",
    port: PORT,
    path: "/",
    method: "GET",
  };

  const req = http.request(options, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      try {
        assert.strictEqual(
          data,
          "No environment message set!",
          `Unexpected response body: ${data}`
        );
        console.log("Server integration test passed");
      } catch (err) {
        console.error("Server integration test failed:", err.message);
        process.exitCode = 1;
      } finally {
        server.close();
      }
    });
  });

  req.on("error", (err) => {
    console.error("Request error:", err.message);
    process.exitCode = 1;
    server.close();
  });

  req.end();
});